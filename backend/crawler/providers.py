"""Independent provider adapters. No API credentials are placed in URLs or logs."""

from __future__ import annotations

import os
from dataclasses import dataclass

import requests

from crawler.parsers.ats import _plain_text, _iso_date, _iso_timestamp, _finish_job, _pick_location
from crawler.parsers.ats import parse_direct_ats
from crawler.parsers.handshake import parse_job_handshake
from crawler.parsers.linkedin import parse_job_linkedin
from crawler.sources import SourceSpec


@dataclass(frozen=True)
class FetchResult:
    jobs: list[dict]
    discovered: int = 0
    skipped: int = 0
    errors: int = 0
    rate_limited: bool = False
    error_code: str | None = None


class ProviderError(Exception):
    def __init__(self, code: str, *, rate_limited: bool = False):
        super().__init__(code)
        self.code = code
        self.rate_limited = rate_limited


def _credentials(name: str) -> tuple[str, ...] | None:
    names = {"adzuna": ("ADZUNA_APP_ID", "ADZUNA_APP_KEY"),
             "usajobs": ("USAJOBS_EMAIL", "USAJOBS_API_KEY")}[name]
    values = tuple(os.environ.get(key, "").strip() for key in names)
    return values if all(values) else None


def enabled(name: str) -> bool:
    return name not in {"adzuna", "usajobs"} or _credentials(name) is not None


def _get_json(url: str, *, params=None, headers=None, timeout=20):
    try:
        response = requests.get(url, params=params, headers=headers, timeout=timeout)
        if response.status_code == 429:
            raise ProviderError("rate_limited", rate_limited=True)
        response.raise_for_status()
        return response.json()
    except ProviderError:
        raise
    except (requests.RequestException, ValueError) as exc:
        # Exception messages can include URLs containing API keys. Keep only a safe code.
        raise ProviderError(type(exc).__name__) from None


def _adzuna(raw: dict) -> dict | None:
    location_data = raw.get("location") or {}
    areas = location_data.get("area") or [] if isinstance(location_data, dict) else []
    location = str(location_data.get("display_name") or "") if isinstance(location_data, dict) else ""
    if not location and areas:
        location = ", ".join(reversed(areas[-2:]))
    description = _plain_text(raw.get("description"))
    company_data = raw.get("company") or {}
    company = company_data.get("display_name") if isinstance(company_data, dict) else None
    return _finish_job(
        provider="adzuna", source_job_id=raw.get("id"), title=str(raw.get("title") or ""),
        company=str(company or ""), description=description,
        selected_location=_pick_location([location], "On-site", description),
        date_posted=_iso_date(raw.get("created")), source_updated_at=None,
        application_link=raw.get("redirect_url"), job_type=None, source_level=None,
        salary=None, company_logo_url=None,
    )


def _usajobs(raw: dict) -> dict | None:
    descriptor = raw.get("MatchedObjectDescriptor") or {}
    if not isinstance(descriptor, dict):
        return None
    user_area = descriptor.get("UserArea") or {}
    details = user_area.get("Details") or {} if isinstance(user_area, dict) else {}
    locations = [item.get("LocationName", "") for item in (descriptor.get("PositionLocation") or []) if isinstance(item, dict)]
    description = "\n".join(str(details.get(key) or "") for key in ("JobSummary", "Duties", "Qualifications"))
    apply_urls = descriptor.get("ApplyURI") or []
    if isinstance(apply_urls, str):
        apply_urls = [apply_urls]
    result = _finish_job(
        provider="usajobs", source_job_id=descriptor.get("PositionID") or raw.get("MatchedObjectId"),
        title=str(descriptor.get("PositionTitle") or ""),
        company=str(descriptor.get("OrganizationName") or ""), description=description,
        selected_location=_pick_location(locations, "On-site", description),
        date_posted=_iso_date(descriptor.get("PublicationStartDate")),
        source_updated_at=_iso_timestamp(descriptor.get("PositionDate")),
        application_link=apply_urls[0] if apply_urls else descriptor.get("PositionURI"),
        job_type=None, source_level=None, salary=None, company_logo_url=None,
    )
    if result:
        result["source_url"] = descriptor.get("PositionURI") or result["application_link"]
    return result


def _official_jobs(spec: SourceSpec, *, max_jobs: int, timeout: int) -> FetchResult:
    credentials = _credentials(spec.provider)
    if not credentials:
        return FetchResult([], error_code="credentials_missing")
    if spec.provider == "adzuna":
        app_id, app_key = credentials
        payload = _get_json("https://api.adzuna.com/v1/api/jobs/us/search/1",
                            params={"app_id": app_id, "app_key": app_key, "results_per_page": min(max_jobs, 50),
                                    "what": "software engineer intern", "where": "Dallas, TX"},
                            headers={"Accept": "application/json"}, timeout=timeout)
        raw_jobs = payload.get("results", [])
        normalize = _adzuna
    else:
        email, api_key = credentials
        payload = _get_json("https://data.usajobs.gov/api/search",
                            params={"JobCategoryCode": "2210", "LocationName": "Dallas, Texas",
                                    "ResultsPerPage": min(max_jobs, 50), "WhoMayApply": "Public"},
                            headers={"Host": "data.usajobs.gov", "User-Agent": email,
                                     "Authorization-Key": api_key}, timeout=timeout)
        raw_jobs = payload.get("SearchResult", {}).get("SearchResultItems", [])
        normalize = _usajobs
    if not isinstance(raw_jobs, list):
        raise ProviderError("invalid_payload")
    jobs = []
    for raw in raw_jobs:
        if not isinstance(raw, dict):
            continue
        try:
            job = normalize(raw)
        except (TypeError, ValueError, AttributeError):
            continue
        if job:
            jobs.append(job)
    return FetchResult(jobs[:max_jobs], discovered=len(raw_jobs), skipped=len(raw_jobs) - len(jobs))


def fetch(spec: SourceSpec, *, max_jobs: int, time_limit_sec: int) -> FetchResult:
    """Fetch one source; caller isolates failures and persists safe health metadata."""
    if spec.provider in {"adzuna", "usajobs"}:
        return _official_jobs(spec, max_jobs=max_jobs, timeout=max(1, min(20, time_limit_sec)))
    stats: dict[str, int] = {}
    if spec.provider == "linkedin":
        jobs = parse_job_linkedin(spec.url, max_jobs=max_jobs, time_limit_sec=time_limit_sec, stats=stats)
    elif spec.provider == "handshake":
        jobs = parse_job_handshake(spec.url, max_jobs=max_jobs, time_limit_sec=time_limit_sec, stats=stats)
    elif spec.provider in {"greenhouse", "lever", "ashby"}:
        jobs = parse_direct_ats(spec.url, provider=spec.provider, company=spec.company or "",
                                max_jobs=max_jobs, time_limit_sec=time_limit_sec, stats=stats)
    else:
        raise ProviderError("unsupported_provider")
    return FetchResult(jobs, stats.get("discovered", len(jobs)), stats.get("skipped", 0),
                       stats.get("errors", 0), bool(stats.get("rate_limited")),
                       "rate_limited" if stats.get("rate_limited") else None)
