"""Conservative content-level duplicate detection for feed rows."""

from __future__ import annotations

import re
from difflib import SequenceMatcher
from urllib.parse import urlsplit


def _normalized(value: object) -> str:
    return re.sub(r"[^a-z0-9+#]+", " ", str(value or "").lower()).strip()


def exact_posting_key(row: dict) -> tuple[str, ...] | None:
    """Identify indistinguishable reposts without merging merely similar roles."""
    description = row.get("job_description") or row.get("fullDescription")
    values = (
        row.get("company"),
        row.get("job_title") or row.get("title"),
        row.get("location"),
        row.get("work_style") or row.get("hybrid"),
        description,
    )
    normalized = tuple(_normalized(value) for value in values)
    if not all(normalized):
        return None
    return normalized


def _company_core(value: object) -> str:
    ignored = {"co", "company", "companies", "corp", "corporation", "inc", "insurance", "llc"}
    return " ".join(word for word in _normalized(value).split() if word not in ignored)


def duplicate_reason(candidate: dict, keeper: dict) -> str | None:
    """Return a reason only for exact or extremely close cross-source reposts."""
    candidate_url = str(candidate.get("canonical_url") or candidate.get("application_link") or candidate.get("applicationLink") or "").strip().lower()
    keeper_url = str(keeper.get("canonical_url") or keeper.get("application_link") or keeper.get("applicationLink") or "").strip().lower()
    if candidate_url and candidate_url == keeper_url:
        return f"same canonical application URL as active row {keeper.get('id')}"
    candidate_exact = exact_posting_key(candidate)
    keeper_exact = exact_posting_key(keeper)
    if candidate_exact and candidate_exact == keeper_exact:
        return f"exact duplicate of active row {keeper.get('id')}"

    candidate_source = _normalized(candidate.get("source"))
    keeper_source = _normalized(keeper.get("source"))
    if not candidate_source or not keeper_source or candidate_source == keeper_source:
        return None
    if _company_core(candidate.get("company")) != _company_core(keeper.get("company")):
        return None
    if _normalized(candidate.get("job_title") or candidate.get("title")) != _normalized(
        keeper.get("job_title") or keeper.get("title")
    ):
        return None

    candidate_description = _normalized(
        candidate.get("job_description") or candidate.get("fullDescription")
    )
    keeper_description = _normalized(
        keeper.get("job_description") or keeper.get("fullDescription")
    )
    if min(len(candidate_description), len(keeper_description)) < 500:
        return None
    similarity = SequenceMatcher(
        None, candidate_description, keeper_description, autojunk=False
    ).ratio()
    if similarity >= 0.985:
        return f"near-identical cross-source duplicate of active row {keeper.get('id')}"
    return None


def _posting_preference(row: dict) -> tuple[int, int, int]:
    url = str(row.get("canonical_url") or row.get("application_link") or row.get("applicationLink") or "").strip()
    try:
        path = urlsplit(url).path.rstrip("/").lower()
    except ValueError:
        path = ""
    specific_url = int(path not in {"", "/main", "/jobs", "/careers"})
    source_priority = {
        "greenhouse": 5,
        "lever": 5,
        "ashby": 5,
        "linkedin": 3,
        "handshake": 2,
    }.get(_normalized(row.get("source")), 1)
    return specific_url, source_priority, int(row.get("id") or 0)


def partition_unique_postings(rows: list[dict]) -> tuple[list[dict], list[dict]]:
    """Choose the best representative while preserving original feed order."""
    keepers: list[dict] = []
    duplicates: list[dict] = []
    canonical_keepers: dict[str, dict] = {}
    exact_keepers: dict[tuple[str, ...], dict] = {}
    fuzzy_groups: dict[tuple[str, str], list[dict]] = {}
    for row in sorted(rows, key=_posting_preference, reverse=True):
        url = str(row.get("canonical_url") or row.get("application_link") or row.get("applicationLink") or "").strip().lower()
        exact_key = exact_posting_key(row)
        group_key = (
            _company_core(row.get("company")),
            _normalized(row.get("job_title") or row.get("title")),
        )
        reason = (
            f"same canonical application URL as active row {canonical_keepers[url].get('id')}"
            if url and url in canonical_keepers
            else f"exact duplicate of active row {exact_keepers[exact_key].get('id')}"
            if exact_key and exact_key in exact_keepers
            else None
        )
        if not reason:
            for keeper in fuzzy_groups.get(group_key, []):
                reason = duplicate_reason(row, keeper)
                if reason:
                    break
        if reason:
            duplicates.append({**row, "reason": reason})
        else:
            keepers.append(row)
            if url:
                canonical_keepers[url] = row
            if exact_key:
                exact_keepers[exact_key] = row
            fuzzy_groups.setdefault(group_key, []).append(row)
    keeper_objects = {id(row) for row in keepers}
    return [row for row in rows if id(row) in keeper_objects], duplicates
