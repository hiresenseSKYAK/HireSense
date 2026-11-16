"""Check stale application links and deactivate only confirmed closed jobs."""

import argparse
import os
import time
from urllib.parse import urlparse

import requests

try:
    from database.queries import get_jobs_to_check, update_job_check_status
except ImportError:
    from backend.database.queries import get_jobs_to_check, update_job_check_status

try:
    from crawler.parsers.linkedin import linkedin_posting_state
except ImportError:
    from backend.crawler.parsers.linkedin import linkedin_posting_state

REQUEST_TIMEOUT_SEC = 10
REQUEST_DELAY_SEC = 0.5
# LinkedIn starts answering 429 at about one request per second, so its guest
# checks are spaced further apart and pause after a rate limit.
LINKEDIN_REQUEST_DELAY_SEC = 2.0
RATE_LIMIT_BACKOFF_SEC = 30.0
# Stop checking after this long so the daily GitHub Actions job (45-minute
# timeout) still reaches the age cleanup step. Unchecked jobs go first next run.
MAX_RUNTIME_SEC = int(os.getenv("UPDATER_MAX_RUNTIME_SEC", str(25 * 60)) or 25 * 60)
EXPIRED_HTTP_STATUSES = {404, 410}
# LinkedIn job links (linkedin.com/jobs/view/...) always answer automated
# requests with a redirect or a login wall, so they can never be classified.
# LinkedIn's public guest endpoint for the same posting does show its state:
# a closed posting contains a "closed-job" block reading "No longer accepting
# applications" and has no Apply control, and a removed posting returns 404.
# See linkedin_posting_state in crawler/parsers/linkedin.py.
LINKEDIN_GUEST_POSTING_URL = "https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/{job_id}"
TRANSIENT_HTTP_STATUSES = {401, 403, 408, 425, 429, 500, 502, 503, 504, 999}
CLOSED_PAGE_MARKERS = (
    "no longer accepting applications",
    "no longer accepting applicants",
    "this job is no longer available",
    "this job has expired",
    "this position has been filled",
)
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}


def _host(url):
    try:
        return urlparse(url).netloc.lower() or "unknown"
    except Exception:
        return "unknown"


def _closed_marker(html):
    text = (html or "").lower()
    for marker in CLOSED_PAGE_MARKERS:
        if marker in text:
            return marker
    return None


def classify_linkedin_posting(source_job_id, session=None):
    """Return (expired, reason) for a LinkedIn posting using LinkedIn's guest endpoint.

    LinkedIn's own "No longer accepting applications", or a posting page with
    no Apply control, is treated as final, so callers may close the job on
    this single observation.
    """
    job_id = str(source_job_id or "").strip()
    if not job_id.isdigit():
        return None, "missing LinkedIn job id"
    http = session or requests
    try:
        response = http.get(
            LINKEDIN_GUEST_POSTING_URL.format(job_id=job_id),
            timeout=REQUEST_TIMEOUT_SEC,
            headers=HEADERS,
        )
    except requests.RequestException as exc:
        return None, f"linkedin request failed: {type(exc).__name__}"
    status = response.status_code
    if status in EXPIRED_HTTP_STATUSES:
        return True, f"linkedin posting http {status}"
    if status != 200:
        return None, f"linkedin http {status}"
    state = linkedin_posting_state(response.text)
    if state == "closed":
        return True, "linkedin: no longer accepting applications"
    if state == "no_apply":
        return True, "linkedin: posting has no apply option"
    if state == "open":
        return False, "linkedin posting open"
    return None, "linkedin: unrecognized posting page"


def classify_application_link(url, session=None):
    """
    Return (expired, reason).
    expired is True, False, or None when the posting cannot be classified.

    Redirects are followed so a link that ends on a 404 or a "this job is
    closed" page is recognized. A redirect that ends on a normal page (for
    example a company careers home page) stays inconclusive by design; those
    jobs leave the feed through the 30-day age limit.
    """
    link = (url or "").strip()
    if not link:
        return None, "empty application_link"

    http = session or requests
    try:
        response = http.get(
            link,
            timeout=REQUEST_TIMEOUT_SEC,
            headers=HEADERS,
            allow_redirects=True,
        )
    except requests.RequestException as exc:
        return None, f"request failed: {type(exc).__name__}"

    status = response.status_code
    history = getattr(response, "history", None)
    redirected = isinstance(history, (list, tuple)) and len(history) > 0
    if status in EXPIRED_HTTP_STATUSES:
        return True, f"http {status}" + (" after redirect" if redirected else "")
    if status in TRANSIENT_HTTP_STATUSES:
        return None, f"http {status}"
    if 300 <= status < 400:
        return None, f"redirect http {status}"
    if status >= 400:
        return None, f"http {status}"

    marker = _closed_marker(response.text)
    if marker:
        return True, f"closed page ({marker})"
    if redirected:
        return None, f"redirected to another page (http {status})"
    return False, f"http {status}"


def classify_job(job, session=None):
    """Return (expired, reason, confirmed). confirmed=True means close immediately."""
    if str(job.get("source") or "").lower() == "linkedin" and job.get("source_job_id"):
        expired, reason = classify_linkedin_posting(job.get("source_job_id"), session=session)
        if expired is not None:
            return expired, reason, expired is True
        # Guest endpoint unavailable (rate limit etc.): fall back to the link itself.
    expired, reason = classify_application_link(job.get("application_link"), session=session)
    return expired, reason, False


def update_database(*, max_runtime_sec=None, clock=time.monotonic, linkedin_sweep=False):
    jobs = get_jobs_to_check(linkedin_sweep=linkedin_sweep)
    budget = MAX_RUNTIME_SEC if max_runtime_sec is None else max_runtime_sec
    started = clock()
    skipped_for_time = 0
    deactivated = 0
    possibly_closed = 0
    active = 0
    inconclusive = 0
    failed = 0

    print(f"[updater] checking {len(jobs)} posting(s)", flush=True)
    session = requests.Session()
    session.headers.update(HEADERS)

    for index, job in enumerate(jobs):
        if clock() - started >= budget:
            skipped_for_time = len(jobs) - index
            print(f"[updater] time budget of {budget}s reached; {skipped_for_time} posting(s) left for next run",
                  flush=True)
            break
        job_id = job.get("id")
        link = job.get("application_link")
        expired, reason, confirmed = classify_job(job, session=session)
        host = _host(link)

        if expired is True:
            updated = (update_job_check_status(job_id, active=False, confirmed=True) if confirmed
                       else update_job_check_status(job_id, active=False))
            if updated:
                if confirmed or job.get("status") == "possibly_closed":
                    deactivated += 1
                else:
                    possibly_closed += 1
                print(
                    f"[updater] closure evidence id={job_id} host={host} ({reason})",
                    flush=True,
                )
            else:
                failed += 1
                print(
                    f"[updater] deactivate failed id={job_id} host={host} ({reason})",
                    flush=True,
                )
        elif expired is False:
            if update_job_check_status(job_id, active=True):
                active += 1
            else:
                failed += 1
        else:
            inconclusive += 1
            if not update_job_check_status(job_id, active=None):
                failed += 1
            print(f"[updater] inconclusive id={job_id} host={host} ({reason})", flush=True)

        if index + 1 < len(jobs):
            if "429" in reason:
                time.sleep(RATE_LIMIT_BACKOFF_SEC)
            elif str(job.get("source") or "").lower() == "linkedin":
                time.sleep(LINKEDIN_REQUEST_DELAY_SEC)
            else:
                time.sleep(REQUEST_DELAY_SEC)

    print(
        f"[updater] done: checked={len(jobs)} deactivated={deactivated} possibly_closed={possibly_closed} "
        f"active={active} inconclusive={inconclusive} failed={failed} skipped_for_time={skipped_for_time}",
        flush=True,
    )
    return {
        "checked": len(jobs),
        "deactivated": deactivated,
        "possibly_closed": possibly_closed,
        "active": active,
        "inconclusive": inconclusive,
        "failed": failed,
        "skipped_for_time": skipped_for_time,
    }


def _parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--linkedin-sweep",
        action="store_true",
        help="Check every visible LinkedIn job now, ignoring when it was last checked.",
    )
    return parser.parse_args(argv)


if __name__ == "__main__":
    args = _parse_args()
    result = update_database(linkedin_sweep=args.linkedin_sweep)
    if result["failed"]:
        raise SystemExit(1)
