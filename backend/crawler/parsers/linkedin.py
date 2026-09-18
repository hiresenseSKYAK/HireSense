import re
import time
from datetime import date, timedelta
from urllib.parse import parse_qs, unquote, urlparse

import requests
from bs4 import BeautifulSoup

from services.job_relevance import assess_job_relevance
from services.job_experience import assess_job_experience

BASE_URL = "https://www.linkedin.com"
# Guest `seeMoreJobPostings/search` returns ~10 listing cards per request; the UI
# shows 50+ by loading more pages with increasing `start` (not one giant HTML).
SEARCH_RESULTS_PAGE_SIZE = 10
# Space out paginated search calls; back-to-back requests often get HTTP 429.
SEARCH_PAGE_DELAY_SEC = 1.75
# Detail fetches are the bulk of traffic; no delay here is what usually trips 429s.
JOB_DETAIL_DELAY_SEC = 0.5
SEARCH_429_RETRY_SEC = 8.0
SEARCH_MAX_RETRIES = 3
# LinkedIn experience filter: 1 = Internship, 2 = Entry level
TARGET_EXPERIENCE_FILTER = "1,2"
TARGET_EXPERIENCE_LEVELS = {"Internship", "Entry level"}
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": f"{BASE_URL}/jobs/search",
}


def _safe_text(node):
    return node.get_text(" ", strip=True) if node else None


def _normalize_relative_date(relative_text):
    if not relative_text:
        return None

    text = relative_text.strip().lower()
    today = date.today()

    if "today" in text or "just now" in text:
        return today.strftime("%Y-%m-%d")
    if "yesterday" in text:
        return (today - timedelta(days=1)).strftime("%Y-%m-%d")

    match = re.search(r"(\d+)\s+(hour|day|week|month|year)s?", text)
    if not match:
        return None

    amount = int(match.group(1))
    unit = match.group(2)

    if unit == "hour":
        delta = timedelta(days=0)
    elif unit == "day":
        delta = timedelta(days=amount)
    elif unit == "week":
        delta = timedelta(days=7 * amount)
    elif unit == "month":
        delta = timedelta(days=30 * amount)
    else:  # year
        delta = timedelta(days=365 * amount)

    return (today - delta).strftime("%Y-%m-%d")


def _normalize_linkedin_text(text):
    if not text:
        return ""
    return (
        text.replace("\u2019", "'")
        .replace("\u2018", "'")
        .replace("\u201c", '"')
        .replace("\u201d", '"')
        .replace("\xa0", " ")
    )


def _time_up(deadline):
    return deadline is not None and time.monotonic() >= deadline


def _sleep(seconds, deadline=None):
    """Sleep up to `seconds`, but never past `deadline`. False if time is already up."""
    if _time_up(deadline):
        return False
    if seconds <= 0:
        return True
    if deadline is not None:
        seconds = min(seconds, deadline - time.monotonic())
        if seconds <= 0:
            return False
    time.sleep(seconds)
    return not _time_up(deadline)


def _get_with_retries(session, url, params=None, timeout=15, deadline=None):
    response = None
    for attempt in range(SEARCH_MAX_RETRIES):
        if _time_up(deadline):
            return None
        try:
            response = session.get(url, params=params, timeout=timeout)
        except requests.RequestException:
            if attempt + 1 >= SEARCH_MAX_RETRIES:
                raise
            if not _sleep(SEARCH_429_RETRY_SEC * (attempt + 1), deadline):
                return None
            continue
        if response.status_code != 429:
            return response
        if not _sleep(SEARCH_429_RETRY_SEC * (attempt + 1), deadline):
            return None
    return response


def _normalize_href(href):
    if not href:
        return None
    if href.startswith("/"):
        return f"{BASE_URL}{href}"
    return href


def _is_noise_link(href):
    if not href:
        return True
    lowered = href.lower()
    blocked_tokens = (
        "/legal/",
        "/signup/",
        "/login",
        "/uas/login",
        "request-password-reset",
        "cookie-policy",
        "privacy-policy",
        "user-agreement",
    )
    return any(token in lowered for token in blocked_tokens)


def _is_external_apply_link(href):
    if not href:
        return False
    try:
        parsed = urlparse(href)
    except (TypeError, ValueError):
        return False
    if parsed.scheme.lower() not in {"http", "https"} or not parsed.hostname:
        return False
    if parsed.username or parsed.password:
        return False
    hostname = parsed.hostname.lower()
    blocked_domains = (
        "linkedin.com",
        "licdn.com",
        "static.licdn.com",
    )
    return not any(hostname == domain or hostname.endswith(f".{domain}") for domain in blocked_domains)


def _normalize_location(location_text):
    if not location_text:
        return None
    cleaned = location_text.replace(" Metroplex", "").strip()
    city = cleaned.split(",")[0].strip()
    return city or location_text.strip()


def _extract_external_url_from_description(description):
    if not description:
        return None

    url_with_scheme = re.findall(r"https?://[^\s)>,]+", description)
    bare_www = re.findall(r"\bwww\.[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?:/[^\s)>,]*)?", description)
    candidates = url_with_scheme + [f"https://{value}" for value in bare_www]

    external = [url.rstrip(".,;") for url in candidates if _is_external_apply_link(url)]
    if not external:
        return None

    for url in external:
        lowered = url.lower()
        if any(token in lowered for token in ("apply", "career", "careers", "jobs")):
            return url
    return None


def _extract_external_redirect(href):
    if not href or "linkedin.com" not in href.lower():
        return None
    parsed = urlparse(href)
    query = parse_qs(parsed.query)
    for key in ("url", "redirect", "redirect_url"):
        values = query.get(key)
        if not values:
            continue
        decoded = unquote(values[0])
        if _is_external_apply_link(decoded):
            return decoded
    return None


def _apply_anchor_label(anchor):
    """Human-visible / accessibility label for an apply control (not CSS class soup)."""
    if not anchor:
        return ""
    parts = [
        anchor.get_text(" ", strip=True) or "",
        anchor.get("aria-label") or "",
        anchor.get("title") or "",
    ]
    return " ".join(parts).lower()


def _is_easy_apply_anchor(anchor):
    """LinkedIn on-site application (Easy Apply / Quick Apply) — keep LinkedIn URL."""
    if not anchor:
        return False
    label = _apply_anchor_label(anchor)
    if "easy apply" in label or "easy-apply" in label or "easyapply" in label.replace(" ", ""):
        return True
    if "quick apply" in label or "quick-apply" in label:
        return True
    return False


def _is_plain_apply_anchor(anchor):
    """External / company apply: button says Apply but not Easy Apply."""
    if not anchor:
        return False
    if _is_easy_apply_anchor(anchor):
        return False
    label = _apply_anchor_label(anchor)
    if not label:
        return False
    return bool(re.search(r"\bapply\b", label))


def _extract_salary_from_description(description):
    if not description:
        return None

    text = _normalize_linkedin_text(description)

    # "between $21.19 and $23.37 per hour" — include trailing words so period detection sees "per hour"
    between_range = re.search(
        r"between\s*\$?\s*\d[\d,]*(?:\.\d+)?\s+(?:and|-|–|to)\s*\$?\s*\d[\d,]*(?:\.\d+)?[^.\n]{0,120}",
        text,
        flags=re.IGNORECASE,
    )
    if between_range:
        return between_range.group(0).strip()

    # $X – $Y with hyphen, "to", or "and" (currency optional on the upper bound)
    range_pattern = re.search(
        r"([$€£]\s?\d[\d,]*(?:\.\d+)?\s?(?:k|K)?\s?(?:-|–|to|\band\b)\s*[$€£]?\s?\d[\d,]*(?:\.\d+)?\s?(?:k|K)?(?:\s*(?:/|per)\s*(?:year|yr|month|mo|week|wk|day|hour|hr)|(?:\s*/\s*(?:year|yr|month|mo|week|wk|day|hour|hr)))?)",
        text,
        flags=re.IGNORECASE,
    )
    if range_pattern:
        return range_pattern.group(1).strip()

    # Single amount: do not match $1 (or $50) when followed by million/billion/trillion (business metrics)
    single_pattern = re.search(
        r"((?:USD|EUR|GBP)\s?\d[\d,]*(?:\.\d+)?\s?(?:k|K)?(?:\s*/\s*(?:year|yr|month|mo|week|wk|day|hour|hr))?|[$€£]\s?\d[\d,]*(?:\.\d+)?\s?(?:k|K)?(?:\s*/\s*(?:year|yr|month|mo|week|wk|day|hour|hr))?)(?!\s*(?:million|billion|trillion)\b)",
        text,
        flags=re.IGNORECASE,
    )
    if single_pattern:
        return single_pattern.group(1).strip()

    return None


def _parse_salary_number(raw_amount):
    if not raw_amount:
        return None
    amount_text = raw_amount.strip().replace(",", "")
    multiplier = 1
    if amount_text.lower().endswith("k"):
        multiplier = 1000
        amount_text = amount_text[:-1].strip()
    try:
        return float(amount_text) * multiplier
    except ValueError:
        return None


_SALARY_PERIOD_LOCAL_RADIUS = 120


def _normalize_for_salary_substring_match(text):
    if not text:
        return ""
    t = _normalize_linkedin_text(text)
    for ch in ("\u2013", "\u2014", "\u2212"):
        t = t.replace(ch, "-")
    return re.sub(r"\s+", " ", t)


def _period_multiplier_from_fragment(fragment):
    """Infer hourly/daily/weekly/monthly pay from a short fragment (salary line or local window)."""
    if not fragment:
        return 1
    text = fragment.lower()
    if any(token in text for token in ("/hour", "per hour", "/hr", " hourly", " an hour", "hourly rate")):
        return 2080
    if any(token in text for token in ("/day", "per day", " daily")):
        return 260
    if any(token in text for token in ("/week", "per week", " weekly", "/wk")):
        return 52
    # Do not use bare " monthly" — it matches unrelated phrases like "eligible for monthly bonuses".
    if "/month" in text or "per month" in text:
        return 12
    if re.search(r"(?<![a-z])/mo\b", text):
        return 12
    if re.search(r"\b\d[\d,]*(?:\.\d+)?\s+monthly\b", text):
        return 12
    return 1


def _salary_period_multiplier(salary_text, context_text=None):
    """Use the salary snippet first; only scan a small window around it in the full description.

    Matching pay cues against the entire posting mislabels annual ranges when unrelated text
    contains phrases like "monthly bonuses" (the bare token " monthly" matched inside them).
    """
    m = _period_multiplier_from_fragment(salary_text)
    if m != 1:
        return m
    st = (salary_text or "").strip()
    if not context_text or len(st) < 6:
        return 1

    ctx = _normalize_for_salary_substring_match(context_text)
    st_norm = _normalize_for_salary_substring_match(st)
    idx = ctx.find(st_norm)
    if idx != -1:
        span = len(st_norm)
    else:
        first_amt = re.search(r"\$[\d,]+(?:\.\d+)?", st_norm)
        if not first_amt:
            return 1
        idx = ctx.find(first_amt.group(0))
        if idx == -1:
            return 1
        span = min(len(st_norm), 120)

    r = _SALARY_PERIOD_LOCAL_RADIUS
    lo = max(0, idx - r)
    hi = min(len(ctx), idx + span + r)
    return _period_multiplier_from_fragment(ctx[lo:hi])


def _hourly_rate_pair_hint(salary_text, context_text=None):
    """If LinkedIn shows a compact hourly band (e.g. 67-71) with no period words, treat as hourly."""
    if not (salary_text or "").strip():
        return False
    if _salary_period_multiplier(salary_text, context_text) != 1:
        return False
    combined = ((salary_text or "") + " " + (context_text or "")).lower()
    amounts = re.findall(r"\d[\d,]*(?:\.\d+)?\s*[kK]?", salary_text)
    values = [v for v in (_parse_salary_number(a) for a in amounts) if v is not None]
    if len(values) != 2:
        return False
    lo, hi = min(values[0], values[1]), max(values[0], values[1])
    # Plausible hourly USD (avoids treating $50k-$60k or annual figures as hourly)
    if hi < lo or lo < 8 or hi > 600:
        return False
    has_hour_cue = bool(
        re.search(
            r"(?:\b(?:hour|hr)s?\b|/\s*hr\b|per\s+hour|hourly\s+rate|pay\s+rate)",
            combined,
        )
    )
    if has_hour_cue:
        return True
    # Without "hour" in text, only infer hourly for typical wage bands (avoids e.g. 100–120 as thousands)
    return (hi - lo) <= 120 and hi <= 115


def _normalize_salary_to_annual(salary_text, context_text=None):
    if not salary_text:
        return None

    amounts = re.findall(r"\d[\d,]*(?:\.\d+)?\s*[kK]?", salary_text)
    values = [value for value in (_parse_salary_number(item) for item in amounts) if value]
    if not values:
        return None

    mult = _salary_period_multiplier(salary_text, context_text)
    if mult == 1 and _hourly_rate_pair_hint(salary_text, context_text):
        mult = 2080

    base_value = values[0] if len(values) == 1 else (values[0] + values[1]) / 2
    annual_salary = base_value * mult
    if annual_salary < 10000:
        return None
    return int(round(annual_salary))

def _extract_search_params(start_url):
    parsed = urlparse(start_url)
    query = parse_qs(parsed.query)
    return {
        "keywords": query.get("keywords", [""])[0],
        "location": query.get("location", [""])[0],
        # Always keep HireSense scoped to internship + entry level.
        "f_E": query.get("f_E", [TARGET_EXPERIENCE_FILTER])[0] or TARGET_EXPERIENCE_FILTER,
        "f_WT": query.get("f_WT", [None])[0],
    }


def _resolve_target_experience_level(raw, title=None):
    """Return Internship/Entry level, or None if the posting is out of scope."""
    title_text = (title or "").lower()
    if "intern" in title_text:
        return "Internship"

    if not raw:
        return None

    lower = str(raw).strip().lower()
    if "intern" in lower:
        return "Internship"
    if "entry" in lower or "junior" in lower:
        return "Entry level"
    return None


def _job_id_from_href(href):
    if not href:
        return None
    if "currentJobId=" in href:
        parsed = urlparse(href)
        current_job_id = parse_qs(parsed.query).get("currentJobId", [None])[0]
        if current_job_id and current_job_id.isdigit():
            return current_job_id
    # Newer LinkedIn guest links often encode job id in path:
    # /jobs/view/<slug>-<job_id>
    match = re.search(r"/jobs/view/(?:[^/?#]*-)?(\d+)", href)
    if match:
        return match.group(1)
    return None


def _extract_job_ids(search_html):
    soup = BeautifulSoup(search_html, "html.parser")
    job_ids = []

    # URN is often on a child card, not the wrapping <li>.
    for node in soup.select("[data-entity-urn]"):
        job_id = node.get("data-entity-urn", "").split(":")[-1]
        if job_id.isdigit():
            job_ids.append(job_id)

    for link in soup.select("a.base-card__full-link, a[href*='/jobs/view/'], a[href*='currentJobId=']"):
        job_id = _job_id_from_href(link.get("href", ""))
        if job_id:
            job_ids.append(job_id)

    return list(dict.fromkeys(job_ids))


def _extract_details_from_posting(job_id, session, deadline=None):
    details_url = f"{BASE_URL}/jobs-guest/jobs/api/jobPosting/{job_id}"
    resp = _get_with_retries(session, details_url, deadline=deadline)
    if not resp or resp.status_code != 200:
        return None

    soup = BeautifulSoup(resp.text, "html.parser")
    criteria = {}
    for item in soup.select("li.description__job-criteria-item"):
        header = _safe_text(item.select_one("h3.description__job-criteria-subheader"))
        value = _safe_text(item.select_one("span.description__job-criteria-text"))
        if header and value:
            criteria[header.lower()] = value

    external_candidate = None
    linkedin_easy_apply_candidate = None
    linkedin_plain_apply_fallback = None

    for apply_anchor in soup.select("a"):
        href = _normalize_href(apply_anchor.get("href"))
        if _is_noise_link(href):
            continue

        if _is_easy_apply_anchor(apply_anchor):
            if href and not linkedin_easy_apply_candidate:
                linkedin_easy_apply_candidate = href
            continue

        if not _is_plain_apply_anchor(apply_anchor):
            continue

        if _is_external_apply_link(href):
            external_candidate = href
            break
        redirected_external = _extract_external_redirect(href)
        if redirected_external:
            external_candidate = redirected_external
            break
        if href and not linkedin_plain_apply_fallback:
            linkedin_plain_apply_fallback = href

    if external_candidate:
        application_link = external_candidate
    elif linkedin_easy_apply_candidate:
        application_link = linkedin_easy_apply_candidate
    elif linkedin_plain_apply_fallback:
        application_link = linkedin_plain_apply_fallback
    else:
        application_link = f"{BASE_URL}/jobs/view/{job_id}/"

    description = _normalize_linkedin_text(
        _safe_text(soup.select_one("div.show-more-less-html__markup"))
    )
    salary_text = _safe_text(soup.select_one("span.compensation__salary"))
    if not salary_text:
        salary_text = _extract_salary_from_description(description)
    salary = _normalize_salary_to_annual(salary_text, description)
    relative_date = _safe_text(soup.select_one("span.posted-time-ago__text"))
    selected_link_is_easy_apply = bool(linkedin_easy_apply_candidate) and (
        application_link == linkedin_easy_apply_candidate
    )
    if (
        not external_candidate
        and not selected_link_is_easy_apply
        and application_link
        and "linkedin.com" in application_link.lower()
    ):
        external_from_description = _extract_external_url_from_description(description)
        if external_from_description:
            application_link = external_from_description

    job_title = _safe_text(soup.select_one("h2.top-card-layout__title"))
    experience = assess_job_experience(
        job_title, description, criteria.get("seniority level")
    )
    if not experience.accepted:
        print(
            f"[linkedin] rejected id={job_id} title={job_title!r} "
            f"reason={experience.reason}",
            flush=True,
        )
        return None
    experience_level = experience.level
    relevance = assess_job_relevance(job_title, description)
    if not relevance.relevant:
        print(
            f"[linkedin] rejected id={job_id} title={job_title!r} "
            f"reason={relevance.reason}",
            flush=True,
        )
        return None

    return {
        "source": "linkedin",
        "source_job_id": str(job_id) if job_id is not None else None,
        "job_title": job_title,
        "company": _safe_text(
            soup.select_one("a.topcard__org-name-link, span.topcard__flavor")
        ),
        "location": _normalize_location(
            _safe_text(soup.select_one("span.topcard__flavor--bullet"))
        ),
        "salary": salary,
        "date_posted": _normalize_relative_date(relative_date),
        "application_link": application_link,
        "job_description": description,
        "skills": [],
        "job_type": criteria.get("employment type"),
        "experience_level": experience_level,
        "work_style": criteria.get("workplace type"),
    }


def parse_job_linkedin(start_url, max_jobs=60, time_limit_sec=None, stats=None):
    stats = stats if stats is not None else {}
    stats.update({"discovered": 0, "accepted": 0, "skipped": 0, "errors": 0})
    discovered_ids = set()
    search_params = _extract_search_params(start_url)
    jobs = []
    deadline = (
        time.monotonic() + time_limit_sec if time_limit_sec and time_limit_sec > 0 else None
    )

    with requests.Session() as session:
        session.headers.update(HEADERS)

        start = 0
        search_url = f"{BASE_URL}/jobs-guest/jobs/api/seeMoreJobPostings/search"
        while len(jobs) < max_jobs:
            if _time_up(deadline):
                break
            if start > 0 and not _sleep(SEARCH_PAGE_DELAY_SEC, deadline):
                break

            params = {
                "keywords": search_params["keywords"],
                "location": search_params["location"],
                "f_E": search_params.get("f_E") or TARGET_EXPERIENCE_FILTER,
                "start": start,
            }
            if search_params.get("f_WT"):
                params["f_WT"] = search_params["f_WT"]
            try:
                search_response = _get_with_retries(
                    session, search_url, params=params, deadline=deadline
                )
            except requests.RequestException as exc:
                stats["errors"] += 1
                print(f"[linkedin] search request failed: {type(exc).__name__}", flush=True)
                break

            if not search_response or search_response.status_code != 200:
                stats["errors"] += 1
                status = getattr(search_response, "status_code", "no response")
                print(f"[linkedin] search stopped: HTTP {status}", flush=True)
                break

            job_ids = _extract_job_ids(search_response.text)
            discovered_ids.update(job_ids)
            stats["discovered"] = len(discovered_ids)
            if not job_ids:
                break

            for job_id in job_ids:
                if _time_up(deadline):
                    return jobs
                if not _sleep(JOB_DETAIL_DELAY_SEC, deadline):
                    return jobs
                try:
                    data = _extract_details_from_posting(job_id, session, deadline=deadline)
                    if data and data["job_title"] and data["company"]:
                        jobs.append(data)
                        stats["accepted"] += 1
                    else:
                        stats["skipped"] += 1
                    if len(jobs) >= max_jobs:
                        return jobs
                except requests.RequestException as exc:
                    stats["errors"] += 1
                    print(
                        f"[linkedin] detail request failed id={job_id}: {type(exc).__name__}",
                        flush=True,
                    )
                    continue
                except Exception as exc:
                    stats["errors"] += 1
                    print(
                        f"[linkedin] parser error id={job_id}: {exc}",
                        flush=True,
                    )
                    continue

            start += SEARCH_RESULTS_PAGE_SIZE

    return jobs
