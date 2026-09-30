"""Filter, rank, and page the live job catalog before it reaches the browser."""

from __future__ import annotations

import math
import re
from datetime import datetime, timedelta

try:
    from services.job_match import match_resume_to_job
except ImportError:
    from backend.services.job_match import match_resume_to_job

DEFAULT_PAGE_SIZE = 20
MAX_PAGE_SIZE = 50
CARD_DESCRIPTION_LIMIT = 480

SORTS = {
    "best-match",
    "newest-posted",
    "recently-discovered",
    "company",
    "location",
}

SALARY_BUCKETS = {
    "Under $30k": (0, 30_000),
    "$30k \u2013 $60k": (30_000, 60_000),
    "$60k \u2013 $90k": (60_000, 90_000),
    "$90k \u2013 $120k": (90_000, 120_000),
    "$120k \u2013 $150k": (120_000, 150_000),
    "$150k \u2013 $180k": (150_000, 180_000),
    "$180k \u2013 $210k": (180_000, 210_000),
    "$210k+": (210_000, None),
}

DATE_WINDOWS_DAYS = {
    "Last 7 days": 7,
    "Last 30 days": 30,
}

SKIP_CITIES = {"unknown", "unknown location", "n/a", "na", "none"}


def assemble_job_page(
    jobs: list[dict],
    *,
    page: int = 1,
    page_size: int = DEFAULT_PAGE_SIZE,
    q: str = "",
    cities: list[str] | None = None,
    styles: list[str] | None = None,
    experience: list[str] | None = None,
    salaries: list[str] | None = None,
    job_types: list[str] | None = None,
    dates: list[str] | None = None,
    skills: list[str] | None = None,
    sort: str = "recently-discovered",
    now: datetime | None = None,
) -> dict:
    catalog = list(jobs or [])
    page_size = min(MAX_PAGE_SIZE, max(1, int(page_size or DEFAULT_PAGE_SIZE)))
    page = max(1, int(page or 1))
    moment = now or datetime.now()
    selected_skills = [skill.strip() for skill in (skills or []) if skill and skill.strip()]
    sort_key = sort if sort in SORTS else "recently-discovered"
    if sort_key == "best-match" and not selected_skills:
        sort_key = "recently-discovered"

    filtered = [
        job
        for job in catalog
        if _matches_query(job, q)
        and _matches_choice(extract_city(job.get("location")), cities)
        and _matches_choice(job.get("hybrid"), styles)
        and _matches_choice(job.get("experienceLevel"), experience)
        and _matches_choice(job.get("type"), job_types)
        and _matches_salary(job, salaries)
        and _matches_date(job, dates, moment)
    ]

    ranked = _score_jobs(filtered, selected_skills) if selected_skills else filtered
    ranked = _sort_jobs(ranked, sort_key)
    total = len(ranked)
    page_count = max(1, math.ceil(total / page_size)) if total else 1
    if page > page_count:
        page = page_count
    start = (page - 1) * page_size
    items = [_to_list_item(job) for job in ranked[start : start + page_size]]

    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "cities": unique_cities(catalog),
        "match_summary": _match_summary(ranked) if selected_skills else None,
    }


def extract_city(location) -> str | None:
    if not location:
        return None
    city = str(location).split(",")[0].strip()
    if not city or city.casefold() in SKIP_CITIES:
        return None
    return city


def unique_cities(jobs: list[dict]) -> list[str]:
    by_lower: dict[str, str] = {}
    for job in jobs:
        city = extract_city(job.get("location"))
        if not city:
            continue
        key = city.casefold()
        if key not in by_lower:
            by_lower[key] = city
    return sorted(by_lower.values(), key=str.casefold)


def _matches_query(job: dict, query: str) -> bool:
    needle = (query or "").strip().casefold()
    if not needle:
        return True
    tags = job.get("tags") or []
    return (
        needle in str(job.get("title") or "").casefold()
        or needle in str(job.get("company") or "").casefold()
        or any(needle in str(tag).casefold() for tag in tags)
    )


def _matches_choice(value, selected: list[str] | None) -> bool:
    choices = [item for item in (selected or []) if item]
    if not choices:
        return True
    if value is None:
        return False
    current = str(value).casefold()
    return any(current == choice.casefold() for choice in choices)


def _matches_salary(job: dict, selected: list[str] | None) -> bool:
    labels = [label for label in (selected or []) if label in SALARY_BUCKETS]
    if not labels:
        return True
    salary = _annual_salary_range(job.get("salaryRange", job.get("salary")))
    if not salary:
        return False
    job_min, job_max = salary
    for label in labels:
        bucket_min, bucket_max = SALARY_BUCKETS[label]
        bucket_hi = bucket_max if bucket_max is not None else math.inf
        if job_min < bucket_hi and job_max >= bucket_min:
            return True
    return False


def _looks_hourly(value: str) -> bool:
    lower = value.lower()
    return (
        "/hr" in lower
        or "/hour" in lower
        or "per hour" in lower
        or "hourly" in lower
        or re.search(r"\bhr\b", lower) is not None
    )


def _parse_salary_token(raw: str) -> float | None:
    match = re.search(r"(\d+(?:\.\d+)?)\s*([kK])?", raw.replace(",", ""))
    if not match:
        return None
    amount = float(match.group(1))
    return amount * 1000 if match.group(2) else amount


def _annual_salary_range(value) -> tuple[float, float] | None:
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if not math.isfinite(value) or value < 0:
            return None
        annual = float(value)
        return (annual, annual)

    text = str(value).strip()
    if not text or re.match(r"^not listed$", text, re.IGNORECASE):
        return None
    tokens = re.findall(r"\d[\d,]*(?:\.\d+)?\s*[kK]?", text)
    amounts = [amount for amount in (_parse_salary_token(token) for token in tokens) if amount and amount > 0]
    if not amounts:
        return None
    hourly = _looks_hourly(text)
    annuals = sorted(_to_annual(amount, hourly) for amount in amounts)
    return (annuals[0], annuals[-1])


def _to_annual(amount: float, hourly: bool) -> float:
    if hourly and amount < 1000:
        return round(amount * 2080)
    return amount


def _matches_date(job: dict, selected: list[str] | None, now: datetime) -> bool:
    labels = [label for label in (selected or []) if label == "Last 24 hours" or label in DATE_WINDOWS_DAYS]
    if not labels:
        return True
    posted = _parse_posted(job.get("datePosted") or job.get("posted"), now)
    if posted is None:
        return False
    if _start_of_day(now) < _start_of_day(posted):
        return False
    days_ago = round((_start_of_day(now) - _start_of_day(posted)).total_seconds() / 86_400)
    hours_ago = (now - posted).total_seconds() / 3_600
    for label in labels:
        if label == "Last 24 hours":
            if days_ago == 0 or hours_ago <= 24:
                return True
            continue
        window = DATE_WINDOWS_DAYS.get(label)
        if window is not None and days_ago <= window:
            return True
    return False


def _parse_posted(posted, now: datetime) -> datetime | None:
    if posted is None:
        return None
    if isinstance(posted, datetime):
        return posted
    text = str(posted).strip()
    if not text or re.match(r"^recently posted$", text, re.IGNORECASE):
        return None
    iso = re.match(r"^(\d{4}-\d{2}-\d{2})", text)
    if iso:
        try:
            return datetime.fromisoformat(f"{iso.group(1)}T00:00:00")
        except ValueError:
            return None

    lower = text.lower()
    if "just now" in lower or "today" in lower:
        return now
    if "yesterday" in lower:
        return now - timedelta(days=1)
    relative = re.search(r"(\d+)\s+(hour|day|week|month)s?\s+ago", lower)
    if not relative:
        try:
            parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError:
            return None
        if parsed.tzinfo is not None:
            parsed = parsed.astimezone().replace(tzinfo=None)
        return parsed

    amount = int(relative.group(1))
    unit = relative.group(2)
    if unit == "hour":
        return now - timedelta(hours=amount)
    if unit == "day":
        return now - timedelta(days=amount)
    if unit == "week":
        return now - timedelta(days=amount * 7)
    return now - timedelta(days=amount * 30)


def _start_of_day(value: datetime) -> datetime:
    return value.replace(hour=0, minute=0, second=0, microsecond=0)


def _timestamp(value) -> float:
    if isinstance(value, datetime):
        return value.timestamp()
    if not value:
        return 0
    text = str(value).strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return 0
    if parsed.tzinfo is not None:
        return parsed.timestamp()
    return parsed.timestamp()


def _score_jobs(jobs: list[dict], skills: list[str]) -> list[dict]:
    resume = {"skills": skills}
    scored = []
    for job in jobs:
        result = match_resume_to_job(resume, job)
        scored.append({**job, "match": result["matchScore"], "matchDetails": result})
    return scored


def _sort_jobs(jobs: list[dict], sort: str) -> list[dict]:
    def job_id(job: dict) -> int:
        try:
            return int(job.get("id") or 0)
        except (TypeError, ValueError):
            return 0

    if sort == "best-match":
        return sorted(jobs, key=lambda job: (-int(job.get("match") or 0), -_timestamp(job.get("firstSeenAt")), -job_id(job)))
    if sort == "newest-posted":
        return sorted(jobs, key=lambda job: (-_timestamp(job.get("datePosted") or job.get("posted")), -job_id(job)))
    if sort == "company":
        return sorted(jobs, key=lambda job: (str(job.get("company") or "").casefold(), job_id(job)))
    if sort == "location":
        return sorted(jobs, key=lambda job: (str(job.get("location") or "").casefold(), job_id(job)))
    return sorted(jobs, key=lambda job: (-_timestamp(job.get("firstSeenAt")), -job_id(job)))


def _match_summary(jobs: list[dict]) -> dict:
    scores = []
    for job in jobs:
        details = job.get("matchDetails") or {}
        if details.get("matchedSkills") or details.get("missingSkills"):
            scores.append(int(job.get("match") or 0))
    if not scores:
        return {"strong": 0, "average": None, "highest": None, "scored": 0}
    return {
        "strong": sum(1 for score in scores if score >= 70),
        "average": round(sum(scores) / len(scores)),
        "highest": max(scores),
        "scored": len(scores),
    }


def _to_list_item(job: dict) -> dict:
    item = {key: value for key, value in job.items() if key != "fullDescription"}
    description = item.get("description")
    if isinstance(description, str) and len(description) > CARD_DESCRIPTION_LIMIT:
        item["description"] = description[:CARD_DESCRIPTION_LIMIT].rstrip() + "\u2026"
    return item
