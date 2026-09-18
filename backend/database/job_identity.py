"""Stable, provider-neutral identity helpers for crawled jobs."""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit


_TRACKING_QUERY_KEYS = {
    "ref",
    "refid",
    "trk",
    "trkinfo",
    "trackingid",
}


@dataclass(frozen=True)
class JobIdentity:
    source: str | None
    source_job_id: str | None
    canonical_url: str | None
    identity_key: str
    strategy: str


def _clean_text(value: object) -> str:
    return " ".join(str(value or "").strip().lower().split())


def normalize_application_url(value: object) -> str | None:
    """Normalize stable URL structure without following redirects or removing functional data."""
    raw = str(value or "").strip()
    if not raw:
        return None
    if raw.startswith("//"):
        raw = "https:" + raw
    elif "://" not in raw:
        raw = "https://" + raw

    try:
        parsed = urlsplit(raw)
        scheme = parsed.scheme.lower()
        if scheme not in {"http", "https"} or not parsed.hostname:
            return None
        hostname = parsed.hostname.lower()
        if hostname.startswith("www."):
            hostname = hostname[4:]
        port = parsed.port
        netloc = hostname
        if port and not ((scheme == "http" and port == 80) or (scheme == "https" and port == 443)):
            netloc = f"{hostname}:{port}"
        path = re.sub(r"/{2,}", "/", parsed.path or "/")
        if path != "/":
            path = path.rstrip("/")
        query = [
            (key, item)
            for key, item in parse_qsl(parsed.query, keep_blank_values=True)
            if not key.lower().startswith("utm_") and key.lower() not in _TRACKING_QUERY_KEYS
        ]
        query.sort(key=lambda pair: (pair[0].lower(), pair[1]))
        return urlunsplit((scheme, netloc, path, urlencode(query, doseq=True), ""))
    except (TypeError, ValueError):
        return None


def infer_source_identity(canonical_url: str | None) -> tuple[str | None, str | None]:
    if not canonical_url:
        return None, None
    parsed = urlsplit(canonical_url)
    host = (parsed.hostname or "").lower()
    if host.endswith("linkedin.com"):
        match = re.search(r"/jobs/view/(?:[^/?#]*-)?(\d+)", parsed.path)
        if match:
            return "linkedin", match.group(1)
        current = dict(parse_qsl(parsed.query)).get("currentJobId")
        if current and current.isdigit():
            return "linkedin", current
    if host.endswith("joinhandshake.com"):
        match = re.search(r"/public/jobs/(\d+)", parsed.path)
        if match:
            return "handshake", match.group(1)
    return None, None


def build_job_identity(job: dict) -> JobIdentity | None:
    canonical_url = normalize_application_url(job.get("application_link"))
    source = _clean_text(job.get("source")) or None
    source_job_id = str(job.get("source_job_id") or "").strip() or None
    if not source or not source_job_id:
        inferred_source, inferred_id = infer_source_identity(canonical_url)
        source = source or inferred_source
        source_job_id = source_job_id or inferred_id

    if source and source_job_id:
        material = f"source|{source}|{source_job_id}"
        strategy = "source_job_id"
    elif canonical_url:
        material = f"url|{canonical_url}"
        strategy = "canonical_url"
    else:
        fallback = [
            _clean_text(job.get("job_title")),
            _clean_text(job.get("company")),
            _clean_text(job.get("location")),
            _clean_text(job.get("date_posted")),
        ]
        if not all(fallback):
            return None
        material = "fallback|" + "|".join(fallback)
        strategy = "title_company_location_date"

    return JobIdentity(
        source=source,
        source_job_id=source_job_id,
        canonical_url=canonical_url,
        identity_key=hashlib.sha256(material.encode("utf-8")).hexdigest(),
        strategy=strategy,
    )
