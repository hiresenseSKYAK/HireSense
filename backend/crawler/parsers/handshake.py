import json
import re
import time
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

from services.job_relevance import assess_job_relevance
from services.job_experience import assess_job_experience

try:
    from crawler.parsers.linkedin import (
        JOB_DETAIL_DELAY_SEC,
        _extract_external_url_from_description,
        _extract_salary_from_description,
        _get_with_retries,
        _normalize_linkedin_text,
        _normalize_salary_to_annual,
        _sleep,
        _time_up,
    )
except ImportError:
    try:
        from parsers.linkedin import (
            JOB_DETAIL_DELAY_SEC,
            _extract_external_url_from_description,
            _extract_salary_from_description,
            _get_with_retries,
            _normalize_linkedin_text,
            _normalize_salary_to_annual,
            _sleep,
            _time_up,
        )
    except ImportError:
        from backend.crawler.parsers.linkedin import (
            JOB_DETAIL_DELAY_SEC,
            _extract_external_url_from_description,
            _extract_salary_from_description,
            _get_with_retries,
            _normalize_linkedin_text,
            _normalize_salary_to_annual,
            _sleep,
            _time_up,
        )


PUBLIC_BASE = "https://joinhandshake.com"
APP_BASE = "https://app.joinhandshake.com"
TARGET_EXPERIENCE_LEVELS = {"Internship", "Entry level"}
# Handshake public SEO pages render a fixed card grid; `?page=` is ignored.
SEARCH_RESULTS_PAGE_SIZE = 15
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": f"{PUBLIC_BASE}/find-jobs",
}
_PUBLIC_JOB_ID_RE = re.compile(
    r"(?:app\.)?joinhandshake\.com/public/jobs/(\d+)",
    re.IGNORECASE,
)
_SENIOR_TITLE_RE = re.compile(
    r"\b(senior|sr\.?|staff|principal|director|vp|vice[ -]?president|"
    r"head of|chief|architect|manager)\b",
    re.IGNORECASE,
)
_EMPLOYMENT_TYPE_MAP = {
    "FULL_TIME": "Full-time",
    "FULLTIME": "Full-time",
    "PART_TIME": "Part-time",
    "PARTTIME": "Part-time",
    "CONTRACTOR": "Contract",
    "CONTRACT": "Contract",
    "TEMPORARY": "Temporary",
    "INTERN": "Internship",
    "INTERNSHIP": "Internship",
    "VOLUNTEER": "Volunteer",
}


def _normalize_text(text):
    return _normalize_linkedin_text(text)


def _html_to_text(html):
    if not html:
        return ""
    return _normalize_text(BeautifulSoup(html, "html.parser").get_text(" ", strip=True))


def _as_list(value):
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [value]


def _clean_job_title(title):
    if not title:
        return None
    parts = [part.strip() for part in str(title).split("|") if part.strip()]
    if len(parts) >= 2 and parts[-1].lower() == "handshake":
        parts = parts[:-1]
        if len(parts) >= 2:
            return parts[0]
    return parts[0] if parts else str(title).strip()


def _job_id_from_url(url):
    if not url:
        return None
    match = _PUBLIC_JOB_ID_RE.search(url)
    return match.group(1) if match else None


def _public_job_url(job_id):
    return f"{APP_BASE}/public/jobs/{job_id}"


def _parse_next_data(html):
    if not html:
        return None
    match = re.search(
        r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>',
        html,
        flags=re.DOTALL,
    )
    if not match:
        return None
    try:
        return json.loads(match.group(1))
    except json.JSONDecodeError:
        return None


def _parse_jobposting_ld(html):
    if not html:
        return None
    soup = BeautifulSoup(html, "html.parser")
    for script in soup.select('script[type="application/ld+json"]'):
        raw = script.string or script.get_text()
        if not raw:
            continue
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            continue
        for node in _as_list(payload) + _as_list(
            payload.get("@graph") if isinstance(payload, dict) else None
        ):
            if isinstance(node, dict) and node.get("@type") == "JobPosting":
                return node
    return None


def _extract_search_jobs(search_html):
    jobs = []
    next_data = _parse_next_data(search_html)
    page_props = ((next_data or {}).get("props") or {}).get("pageProps") or {}
    search_location = page_props.get("location") or {}

    for card in page_props.get("jobs") or []:
        if not isinstance(card, dict):
            continue
        public_url = card.get("publicUrl")
        job_id = _job_id_from_url(public_url)
        if not job_id:
            continue
        jobs.append({"job_id": job_id, "card": card, "search_location": search_location})

    if jobs:
        return jobs

    soup = BeautifulSoup(search_html, "html.parser")
    seen = set()
    for anchor in soup.select('a[href*="/public/jobs/"]'):
        job_id = _job_id_from_url(anchor.get("href", ""))
        if not job_id or job_id in seen:
            continue
        seen.add(job_id)
        jobs.append({"job_id": job_id, "card": {}, "search_location": search_location})
    return jobs


def _location_from_card(card, search_location=None):
    locations = [loc for loc in (card.get("parsedLocations") or []) if isinstance(loc, dict)]
    if any(loc.get("isRemote") for loc in locations):
        return "Remote"
    if isinstance(search_location, dict) and search_location.get("isRemote"):
        return "Remote"

    wanted_city = None
    if isinstance(search_location, dict):
        wanted_city = (search_location.get("city") or "").strip().lower()
    if wanted_city:
        for loc in locations:
            city = (loc.get("city") or "").strip()
            if city.lower() == wanted_city:
                return city

    for loc in locations:
        city = (loc.get("city") or "").strip()
        if city:
            return city
    return None


def _location_from_posting(posting):
    for place in _as_list(posting.get("jobLocation")):
        if not isinstance(place, dict):
            continue
        address = place.get("address") or {}
        if not isinstance(address, dict):
            continue
        city = (address.get("addressLocality") or "").strip()
        if city:
            return city
    loc_type = str(posting.get("jobLocationType") or "").upper()
    if loc_type == "TELECOMMUTE":
        return "Remote"
    return None


def _work_style(posting, card):
    loc_type = str(posting.get("jobLocationType") or "").upper()
    if loc_type == "TELECOMMUTE":
        return "Remote"
    locations = [loc for loc in (card.get("parsedLocations") or []) if isinstance(loc, dict)]
    if any(loc.get("isRemote") for loc in locations):
        return "Remote"
    description = (posting.get("description") or "").lower()
    if "hybrid" in description:
        return "Hybrid"
    if re.search(r"\bremote\b", description):
        return "Remote"
    return "On-site"


def _map_employment_type(raw, fallback=None):
    if raw is None or raw == "":
        return fallback
    if isinstance(raw, list):
        mapped = [_map_employment_type(item) for item in raw]
        mapped = [item for item in mapped if item]
        return mapped[0] if mapped else fallback
    text = str(raw).strip()
    mapped = _EMPLOYMENT_TYPE_MAP.get(text.upper().replace(" ", "_"))
    if mapped:
        return mapped
    lower = text.lower()
    if "intern" in lower:
        return "Internship"
    if "part" in lower:
        return "Part-time"
    if "full" in lower:
        return "Full-time"
    return text or fallback


def _period_multiplier_from_unit(unit_text):
    unit = str(unit_text or "YEAR").upper()
    if "HOUR" in unit or unit in {"HR", "HRLY"}:
        return 2080
    if "DAY" in unit:
        return 260
    if "WEEK" in unit:
        return 52
    if "MONTH" in unit:
        return 12
    return 1


def _coerce_number(value):
    if isinstance(value, (int, float)):
        return float(value)
    if not isinstance(value, str):
        return None
    try:
        return float(value.replace(",", "").strip())
    except ValueError:
        return None


def _annualize_amount(amount, multiplier):
    if amount is None:
        return None
    annual = amount * multiplier
    if annual < 10000:
        return None
    return int(round(annual))


def _salary_from_jobposting(posting):
    base = posting.get("baseSalary")
    if isinstance(base, list):
        base = base[0] if base else None
    if not isinstance(base, dict):
        return None
    value = base.get("value")
    if isinstance(value, (int, float, str)):
        amount = _coerce_number(value)
        return _annualize_amount(amount, 1)
    if not isinstance(value, dict):
        return None
    amounts = [
        number
        for number in (
            _coerce_number(value.get("minValue")),
            _coerce_number(value.get("maxValue")),
            _coerce_number(value.get("value")),
        )
        if number is not None
    ]
    if not amounts:
        return None
    midpoint = amounts[0] if len(amounts) == 1 else (min(amounts) + max(amounts)) / 2
    return _annualize_amount(midpoint, _period_multiplier_from_unit(value.get("unitText")))


def _salary_from_search_card(card):
    amounts = [
        number
        for number in (_coerce_number(card.get("salaryMin")), _coerce_number(card.get("salaryMax")))
        if number is not None
    ]
    if not amounts:
        return None
    midpoint = amounts[0] if len(amounts) == 1 else (amounts[0] + amounts[1]) / 2
    schedule = str(card.get("paySchedule") or "").lower()
    if "hour" in schedule:
        multiplier = 2080
    elif "day" in schedule:
        multiplier = 260
    elif "week" in schedule:
        multiplier = 52
    elif "month" in schedule:
        multiplier = 12
    else:
        multiplier = 1
    return _annualize_amount(midpoint, multiplier)


def _date_posted(posting, card):
    for raw in (posting.get("datePosted"), card.get("firstActiveAt")):
        if not raw:
            continue
        text = str(raw).strip()
        match = re.match(r"(\d{4}-\d{2}-\d{2})", text)
        if match:
            return match.group(1)
    return None


def _resolve_handshake_experience_level(job_type, title):
    """Keep Handshake scoped to internship + early-career roles."""
    title_text = (title or "").lower()
    type_text = str(job_type or "").strip().lower()

    if "intern" in title_text or "intern" in type_text or "co-op" in title_text or "coop" in title_text:
        return "Internship"
    if any(token in title_text for token in ("entry", "junior", "new grad", "early career", "associate")):
        return "Entry level"
    if _SENIOR_TITLE_RE.search(title_text):
        return None
    if type_text == "job":
        # Handshake is an early-career board; public "Job" listings are treated as entry level
        # unless the title is clearly senior.
        return "Entry level"
    return None


def _organization_name(posting):
    org = posting.get("hiringOrganization")
    if isinstance(org, list):
        org = org[0] if org else None
    if isinstance(org, dict):
        return org.get("name")
    if isinstance(org, str):
        return org
    return None


def _application_link(job_id, posting, description):
    public_url = _public_job_url(job_id)
    external = _extract_external_url_from_description(description)
    if external and "joinhandshake.com" not in external.lower():
        return external
    org = posting.get("hiringOrganization")
    if isinstance(org, list):
        org = org[0] if org else None
    same_as = org.get("sameAs") if isinstance(org, dict) else None
    if same_as:
        lowered = same_as.lower()
        if any(token in lowered for token in ("apply", "career", "careers", "jobs")):
            return same_as
    return public_url


def _extract_details_from_posting(job_id, session, card=None, search_location=None, deadline=None):
    card = card or {}
    details_url = _public_job_url(job_id)
    resp = _get_with_retries(session, details_url, deadline=deadline)
    if not resp or resp.status_code != 200:
        return None

    posting = _parse_jobposting_ld(resp.text) or {}
    job_title = card.get("jobTitle") or _clean_job_title(posting.get("title"))
    company = card.get("employerName") or _organization_name(posting)
    description = _html_to_text(posting.get("description"))
    job_type = _map_employment_type(
        posting.get("employmentType"),
        fallback=card.get("jobType"),
    )
    source_level = card.get("jobType") or job_type
    experience = assess_job_experience(job_title, description, source_level)
    # Handshake's public early-career board labels some non-senior roles simply
    # as "Job". Preserve that source signal after explicit senior/years checks.
    if not experience.accepted and str(source_level or "").strip().lower() == "job":
        legacy_level = _resolve_handshake_experience_level(source_level, job_title)
        if legacy_level:
            experience = assess_job_experience(
                f"Entry level {job_title or ''}", description, "Entry level"
            )
    if not experience.accepted:
        print(
            f"[handshake] rejected id={job_id} title={job_title!r} "
            f"reason={experience.reason}",
            flush=True,
        )
        return None
    experience_level = experience.level
    relevance = assess_job_relevance(job_title, description)
    if not relevance.relevant:
        print(
            f"[handshake] rejected id={job_id} title={job_title!r} "
            f"reason={relevance.reason}",
            flush=True,
        )
        return None

    salary = _salary_from_jobposting(posting)
    if salary is None:
        salary = _salary_from_search_card(card)
    if salary is None:
        salary_text = _extract_salary_from_description(description)
        salary = _normalize_salary_to_annual(salary_text, description)

    location = _location_from_card(card, search_location) or _location_from_posting(posting)

    return {
        "source": "handshake",
        "source_job_id": str(job_id) if job_id is not None else None,
        "job_title": job_title,
        "company": company,
        "location": location,
        "salary": salary,
        "date_posted": _date_posted(posting, card),
        "application_link": _application_link(job_id, posting, description),
        "job_description": description,
        "skills": [],
        "job_type": job_type,
        "experience_level": experience_level,
        "work_style": _work_style(posting, card),
    }


def parse_job_handshake(start_url, max_jobs=60, time_limit_sec=None, stats=None):
    stats = stats if stats is not None else {}
    stats.update({"discovered": 0, "accepted": 0, "skipped": 0, "errors": 0})
    jobs = []
    deadline = (
        time.monotonic() + time_limit_sec if time_limit_sec and time_limit_sec > 0 else None
    )
    direct_job_id = _job_id_from_url(start_url)

    with requests.Session() as session:
        session.headers.update(HEADERS)

        if direct_job_id:
            stats["discovered"] = 1
            try:
                data = _extract_details_from_posting(direct_job_id, session, deadline=deadline)
                if data and data["job_title"] and data["company"]:
                    jobs.append(data)
                    stats["accepted"] = 1
                else:
                    stats["skipped"] = 1
            except requests.RequestException as exc:
                stats["errors"] += 1
                print(f"[handshake] detail request failed: {type(exc).__name__}", flush=True)
                return jobs
            return jobs

        search_url = start_url
        parsed = urlparse(start_url)
        if not parsed.scheme:
            search_url = urljoin(f"{PUBLIC_BASE}/", start_url)

        try:
            search_response = _get_with_retries(session, search_url, deadline=deadline)
        except requests.RequestException as exc:
            stats["errors"] += 1
            print(f"[handshake] search request failed: {type(exc).__name__}", flush=True)
            return jobs
        if not search_response or search_response.status_code != 200:
            stats["errors"] += 1
            status = getattr(search_response, "status_code", "no response")
            print(f"[handshake] search stopped: HTTP {status}", flush=True)
            return jobs

        discovered_listings = _extract_search_jobs(search_response.text)
        stats["discovered"] = len(discovered_listings)
        listings = discovered_listings[:max_jobs]
        for listing in listings:
            if _time_up(deadline):
                break
            if not _sleep(JOB_DETAIL_DELAY_SEC, deadline):
                break
            try:
                data = _extract_details_from_posting(
                    listing["job_id"],
                    session,
                    card=listing.get("card") or {},
                    search_location=listing.get("search_location"),
                    deadline=deadline,
                )
                if data and data["job_title"] and data["company"]:
                    jobs.append(data)
                    stats["accepted"] += 1
                else:
                    stats["skipped"] += 1
                if len(jobs) >= max_jobs:
                    break
            except requests.RequestException as exc:
                stats["errors"] += 1
                print(
                    f"[handshake] detail request failed id={listing['job_id']}: "
                    f"{type(exc).__name__}",
                    flush=True,
                )
                continue
            except Exception as exc:
                stats["errors"] += 1
                print(
                    f"[handshake] parser error id={listing['job_id']}: {exc}",
                    flush=True,
                )
                continue

    return jobs
