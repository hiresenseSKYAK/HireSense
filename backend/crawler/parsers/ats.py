"""Adapters for public, unauthenticated company ATS job feeds."""

from __future__ import annotations

import re
import time
from datetime import datetime, timezone
from urllib.parse import urlsplit

import requests
from bs4 import BeautifulSoup

from services.job_experience import assess_job_experience
from services.job_location import assess_job_location
from services.job_relevance import assess_job_relevance


HEADERS = {
    "User-Agent": "HireSenseJobDiscovery/1.0 (+public job feed reader)",
    "Accept": "application/json,text/html;q=0.8",
}


def _valid_http_url(value: object) -> str | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        parsed = urlsplit(raw)
    except (TypeError, ValueError):
        return None
    if parsed.scheme.lower() not in {"http", "https"} or not parsed.hostname:
        return None
    if parsed.username or parsed.password:
        return None
    return raw


def _plain_text(value: object) -> str:
    if not value:
        return ""
    return BeautifulSoup(str(value), "html.parser").get_text("\n", strip=True)


def _iso_date(value: object) -> str | None:
    text = str(value or "").strip()
    match = re.match(r"(\d{4}-\d{2}-\d{2})", text)
    return match.group(1) if match else None


def _millisecond_date(value: object) -> str | None:
    try:
        timestamp = int(value) / 1000
        return datetime.fromtimestamp(timestamp, tz=timezone.utc).date().isoformat()
    except (TypeError, ValueError, OSError, OverflowError):
        return None


def _midpoint(values: list[object]) -> int | None:
    numbers: list[float] = []
    for value in values:
        try:
            number = float(value)
        except (TypeError, ValueError):
            continue
        if 10_000 <= number <= 2_147_483_647:
            numbers.append(number)
    if not numbers:
        return None
    return int(round((min(numbers) + max(numbers)) / 2))


def _pick_location(candidates: list[str], work_style: str) -> tuple[str, str] | None:
    seen: set[str] = set()
    for candidate in candidates:
        location = " ".join(str(candidate or "").split())
        if not location or location.lower() in seen:
            continue
        seen.add(location.lower())
        decision = assess_job_location(location, work_style)
        if decision.accepted:
            return (
                "Remote" if decision.category == "Remote" else location,
                "Remote" if decision.category == "Remote" else work_style,
            )
    return None


def _metadata_values(job: dict, name: str) -> list[str]:
    values: list[str] = []
    for item in job.get("metadata") or []:
        if not isinstance(item, dict) or str(item.get("name") or "").lower() != name.lower():
            continue
        raw = item.get("value")
        for value in raw if isinstance(raw, list) else [raw]:
            if value:
                values.append(str(value))
    return values


def _normalize_greenhouse_job(job: dict, company: str) -> dict | None:
    title = str(job.get("title") or "").strip()
    description = _plain_text(job.get("content"))
    candidates = _metadata_values(job, "Job Posting Location")
    location = job.get("location") or {}
    if isinstance(location, dict) and location.get("name"):
        candidates.append(str(location["name"]))
    offices = job.get("offices") or []
    candidates.extend(str(item.get("location")) for item in offices if isinstance(item, dict) and item.get("location"))
    remote_evidence = " ".join(candidates + [description])
    work_style = "Remote" if re.search(r"\b(?:remote|work from home|work remotely)\b", remote_evidence, re.I) else "On-site"
    selected = _pick_location(candidates, work_style)
    return _finish_job(
        provider="greenhouse",
        source_job_id=job.get("id"),
        title=title,
        company=str(job.get("company_name") or company).strip(),
        description=description,
        selected_location=selected,
        date_posted=_iso_date(job.get("first_published")),
        application_link=job.get("absolute_url"),
        job_type=None,
        source_level=None,
        salary=None,
        company_logo_url=job.get("company_logo_url") or job.get("logo_url"),
    )


def _normalize_lever_job(job: dict, company: str) -> dict | None:
    title = str(job.get("text") or "").strip()
    description = "\n".join(
        part for part in (
            str(job.get("descriptionPlain") or "").strip(),
            *(
                _plain_text(item.get("content"))
                for item in (job.get("lists") or [])
                if isinstance(item, dict)
            ),
            str(job.get("additionalPlain") or "").strip(),
        ) if part
    )
    categories = job.get("categories") if isinstance(job.get("categories"), dict) else {}
    workplace = str(job.get("workplaceType") or "").lower()
    work_style = "Remote" if workplace == "remote" else "Hybrid" if workplace == "hybrid" else "On-site"
    locations = list(categories.get("allLocations") or [])
    if categories.get("location"):
        locations.append(categories["location"])
    if work_style == "Remote" and str(job.get("country") or "").upper() in {"US", "USA"}:
        locations.insert(0, "Remote — US")
    selected = _pick_location([str(value) for value in locations], work_style)
    salary_range = job.get("salaryRange") if isinstance(job.get("salaryRange"), dict) else {}
    return _finish_job(
        provider="lever",
        source_job_id=job.get("id"),
        title=title,
        company=company,
        description=description,
        selected_location=selected,
        date_posted=_millisecond_date(job.get("createdAt")),
        application_link=job.get("applyUrl") or job.get("hostedUrl"),
        job_type=categories.get("commitment"),
        source_level=job.get("level"),
        salary=_midpoint([salary_range.get("min"), salary_range.get("max")]),
        company_logo_url=job.get("companyLogo") or job.get("logoUrl"),
    )


def _postal_location(value: object) -> str | None:
    if not isinstance(value, dict):
        return None
    postal = value.get("postalAddress") if isinstance(value.get("postalAddress"), dict) else value
    parts = [
        str(postal.get(key) or "").strip()
        for key in ("addressLocality", "addressRegion", "addressCountry")
    ]
    return ", ".join(part for part in parts if part) or None


def _normalize_ashby_job(job: dict, company: str) -> dict | None:
    if job.get("isListed") is False:
        return None
    title = str(job.get("title") or "").strip()
    description = str(job.get("descriptionPlain") or "").strip() or _plain_text(job.get("descriptionHtml"))
    workplace = str(job.get("workplaceType") or "").lower()
    work_style = "Remote" if workplace == "remote" or job.get("isRemote") else "Hybrid" if workplace == "hybrid" else "On-site"
    candidates: list[str] = []
    if job.get("isRemote"):
        for item in job.get("secondaryLocations") or []:
            if not isinstance(item, dict):
                continue
            evidence = _postal_location(item.get("address"))
            label = str(item.get("location") or "").strip()
            if evidence and re.search(r"\bremote\b", label, re.I):
                candidates.append(f"Remote — {evidence}")
            elif label:
                candidates.append(label)
    primary_evidence = _postal_location(job.get("address"))
    if job.get("location"):
        primary = str(job["location"])
        candidates.append(f"{primary}, {primary_evidence}" if primary_evidence and primary_evidence not in primary else primary)
    elif primary_evidence:
        candidates.append(primary_evidence)
    selected = _pick_location(candidates, work_style)
    compensation = job.get("compensation") if isinstance(job.get("compensation"), dict) else {}
    salary_components = [
        component
        for component in (compensation.get("summaryComponents") or [])
        if isinstance(component, dict)
        and component.get("compensationType") == "Salary"
        and component.get("currencyCode") in {None, "USD"}
        and component.get("interval") in {None, "1 YEAR", "YEAR"}
    ]
    salary = _midpoint([
        value
        for component in salary_components
        for value in (component.get("minValue"), component.get("maxValue"))
    ])
    return _finish_job(
        provider="ashby",
        source_job_id=job.get("id"),
        title=title,
        company=company,
        description=description,
        selected_location=selected,
        date_posted=_iso_date(job.get("publishedAt")),
        application_link=job.get("applyUrl") or job.get("jobUrl"),
        job_type=job.get("employmentType"),
        source_level=None,
        salary=salary,
        company_logo_url=job.get("companyLogo") or job.get("logoUrl"),
    )


def _finish_job(
    *, provider: str, source_job_id: object, title: str, company: str,
    description: str, selected_location: tuple[str, str] | None,
    date_posted: str | None, application_link: object, job_type: object,
    source_level: object, salary: int | None, company_logo_url: object,
) -> dict | None:
    if not title or not company or not selected_location:
        return None
    relevance = assess_job_relevance(title, description)
    if not relevance.relevant:
        return None
    experience = assess_job_experience(title, description, source_level or job_type)
    if not experience.accepted:
        return None
    apply_url = _valid_http_url(application_link)
    if not apply_url:
        return None
    location, work_style = selected_location
    return {
        "source": provider,
        "source_job_id": str(source_job_id or "").strip() or None,
        "job_title": title,
        "company": company,
        "company_logo_url": _valid_http_url(company_logo_url),
        "location": location,
        "salary": salary,
        "date_posted": date_posted,
        "application_link": apply_url,
        "job_description": description,
        "skills": [],
        "job_type": job_type,
        "experience_level": experience.level,
        "work_style": work_style,
    }


def _source_backed_logo(session: requests.Session, page_url: object, timeout: int) -> str | None:
    url = _valid_http_url(page_url)
    if not url:
        return None
    try:
        response = session.get(url, timeout=timeout)
        if response.status_code != 200:
            return None
    except requests.RequestException:
        return None
    soup = BeautifulSoup(response.text, "html.parser")
    node = soup.select_one('meta[property="og:image"], meta[name="twitter:image"]')
    return _valid_http_url(node.get("content") if node else None)


_NORMALIZERS = {
    "greenhouse": _normalize_greenhouse_job,
    "lever": _normalize_lever_job,
    "ashby": _normalize_ashby_job,
}


def parse_direct_ats(
    start_url: str,
    *,
    provider: str,
    company: str,
    max_jobs: int = 60,
    time_limit_sec: int | None = None,
    stats: dict[str, int] | None = None,
) -> list[dict]:
    stats = stats if stats is not None else {}
    stats.update({"discovered": 0, "accepted": 0, "skipped": 0, "errors": 0})
    normalizer = _NORMALIZERS.get(provider)
    if not normalizer:
        raise ValueError(f"Unsupported ATS provider: {provider}")
    deadline = time.monotonic() + time_limit_sec if time_limit_sec else None
    timeout = max(1, min(20, int(time_limit_sec or 20)))
    with requests.Session() as session:
        session.headers.update(HEADERS)
        try:
            response = session.get(start_url, timeout=timeout)
            response.raise_for_status()
            payload = response.json()
        except (requests.RequestException, ValueError) as exc:
            stats["errors"] += 1
            print(f"[{provider}] public feed failed for {company}: {type(exc).__name__}", flush=True)
            return []

        raw_jobs = payload.get("jobs") if isinstance(payload, dict) else payload
        if not isinstance(raw_jobs, list):
            stats["errors"] += 1
            return []
        stats["discovered"] = len(raw_jobs)
        jobs: list[dict] = []
        for raw_job in raw_jobs:
            if deadline is not None and time.monotonic() >= deadline:
                break
            if not isinstance(raw_job, dict):
                stats["skipped"] += 1
                continue
            job = normalizer(raw_job, company)
            if not job:
                stats["skipped"] += 1
                continue
            jobs.append(job)
            stats["accepted"] += 1
            if len(jobs) >= max_jobs:
                break

        if jobs and not any(job.get("company_logo_url") for job in jobs):
            remaining = int(deadline - time.monotonic()) if deadline is not None else timeout
            logo = _source_backed_logo(session, jobs[0].get("application_link"), max(1, min(10, remaining))) if remaining > 0 else None
            if logo:
                for job in jobs:
                    job["company_logo_url"] = logo
        return jobs
