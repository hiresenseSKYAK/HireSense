"""Check stale application links and deactivate only confirmed closed jobs."""

import time
from urllib.parse import urlparse

import requests

try:
    from database.queries import get_jobs_to_check, update_job_check_status
except ImportError:
    from backend.database.queries import get_jobs_to_check, update_job_check_status

REQUEST_TIMEOUT_SEC = 10
REQUEST_DELAY_SEC = 0.5
EXPIRED_HTTP_STATUSES = {404, 410}
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


def classify_application_link(url, session=None):
    """
    Return (expired, reason).
    expired is True, False, or None when the posting cannot be classified.
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
            allow_redirects=False,
        )
    except requests.RequestException as exc:
        return None, f"request failed: {type(exc).__name__}"

    status = response.status_code
    if status in EXPIRED_HTTP_STATUSES:
        return True, f"http {status}"
    if status in TRANSIENT_HTTP_STATUSES:
        return None, f"http {status}"
    if 300 <= status < 400:
        return None, f"redirect http {status}"
    if status >= 400:
        return None, f"http {status}"

    marker = _closed_marker(response.text)
    if marker:
        return True, f"closed page ({marker})"
    return False, f"http {status}"


def update_database():
    jobs = get_jobs_to_check()
    deactivated = 0
    active = 0
    inconclusive = 0
    failed = 0

    print(f"[updater] checking {len(jobs)} posting(s)", flush=True)
    session = requests.Session()
    session.headers.update(HEADERS)

    for index, job in enumerate(jobs):
        job_id = job.get("id")
        link = job.get("application_link")
        expired, reason = classify_application_link(link, session=session)
        host = _host(link)

        if expired is True:
            if update_job_check_status(job_id, active=False):
                deactivated += 1
                print(
                    f"[updater] deactivated id={job_id} host={host} ({reason})",
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
            time.sleep(REQUEST_DELAY_SEC)

    print(
        f"[updater] done: checked={len(jobs)} deactivated={deactivated} "
        f"active={active} inconclusive={inconclusive} failed={failed}",
        flush=True,
    )
    return {
        "checked": len(jobs),
        "deactivated": deactivated,
        "active": active,
        "inconclusive": inconclusive,
        "failed": failed,
    }
