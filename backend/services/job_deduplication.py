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


def _place_key(row: dict) -> str:
    """City-level place, so "Dallas, TX", "Dallas, Texas" and "Dallas" match.

    LinkedIn stores only the city, while employer boards store "City, ST", so
    the comparison uses the city. Remote roles compare as "remote".
    """
    location = str(row.get("location") or "")
    work_style = _normalized(row.get("work_style") or row.get("hybrid"))
    lowered = location.lower()
    if "remote" in lowered or (work_style == "remote" and not location.strip()):
        return "remote"
    return _normalized(location.split(",")[0])


def role_key(row: dict) -> tuple[str, str, str] | None:
    """Company, title and city-level place of a posting."""
    key = (
        _company_core(row.get("company")),
        _normalized(row.get("job_title") or row.get("title")),
        _place_key(row),
    )
    return key if all(key) else None


def _same_posting_text(first: str, second: str) -> bool:
    """Whether two normalized descriptions are one posting, lightly edited.

    True when one is an excerpt of the other, or they are at least 90% alike.
    Different roles with the same title (two teams hiring "Software Engineer I"
    in one city) have different descriptions and stay separate.
    """
    if not first or not second:
        return False
    shorter, longer = sorted((first, second), key=len)
    if len(shorter) >= 160 and shorter in longer and len(shorter) / max(len(longer), 1) >= 0.25:
        return True
    first_words, second_words = first.split(), second.split()
    if min(len(first_words), len(second_words)) / max(len(first_words), len(second_words), 1) < 0.8:
        return False
    return SequenceMatcher(None, first_words, second_words, autojunk=False).ratio() >= 0.9


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
    # Reposts: same company, title and city with essentially the same text.
    # LinkedIn reposts one opening under new job IDs with light edits, and
    # LinkedIn stores "Dallas" where an employer board stores "Dallas, TX".
    candidate_role = role_key(candidate)
    if candidate_role and candidate_role == role_key(keeper) and _same_posting_text(
        _normalized(candidate.get("job_description") or candidate.get("fullDescription")),
        _normalized(keeper.get("job_description") or keeper.get("fullDescription")),
    ):
        return f"repost with the same company, title and location as active row {keeper.get('id')}"

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
    if (min(len(candidate_description), len(keeper_description)) >= 160
            and _normalized(candidate.get("location")) == _normalized(keeper.get("location"))):
        shorter, longer = sorted((candidate_description, keeper_description), key=len)
        if shorter in longer and len(shorter) / max(len(longer), 1) >= 0.25:
            return f"same-location cross-source description excerpt of active row {keeper.get('id')}"
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
        "usajobs": 4,
        "adzuna": 3,
        "linkedin": 2,
        "handshake": 1,
    }.get(_normalized(row.get("source")), 1)
    return source_priority, specific_url, int(row.get("id") or 0)


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
