"""Deterministic geography policy for the DFW-focused production feed."""

from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class LocationDecision:
    accepted: bool
    category: str | None
    reason: str


DFW_CITIES = (
    "addison",
    "allen",
    "arlington",
    "bedford",
    "burleson",
    "carrollton",
    "cedar hill",
    "celina",
    "colleyville",
    "coppell",
    "dallas",
    "denton",
    "desoto",
    "duncanville",
    "euless",
    "farmers branch",
    "flower mound",
    "fort worth",
    "frisco",
    "garland",
    "grand prairie",
    "grapevine",
    "haltom city",
    "hurst",
    "irving",
    "keller",
    "lancaster",
    "lewisville",
    "mansfield",
    "mckinney",
    "mesquite",
    "north richland hills",
    "plano",
    "prosper",
    "richardson",
    "roanoke",
    "rockwall",
    "rowlett",
    "sachse",
    "southlake",
    "the colony",
    "trophy club",
    "westlake",
    "wylie",
)

_DFW_CITY_PATTERN = re.compile(
    r"\b(?:" + "|".join(re.escape(city) for city in sorted(DFW_CITIES, key=len, reverse=True)) + r")\b",
    re.IGNORECASE,
)
_DFW_REGION_PATTERN = re.compile(
    r"\b(?:dallas[ -](?:fort worth|ft\.? worth)|dfw|dallas metro(?:plex)?|"
    r"fort worth metro(?:plex)?|north texas)\b",
    re.IGNORECASE,
)
_REMOTE_PATTERN = re.compile(
    r"\b(?:remote|work from home|telecommut(?:e|ing)|anywhere in (?:the )?(?:u\.?s\.?|united states))\b",
    re.IGNORECASE,
)
_US_COUNTRY_PATTERN = re.compile(
    r"\b(?:united states(?: of america)?|u\.?s\.?a?\.?)\b",
    re.IGNORECASE,
)
_US_STATE_NAME_PATTERN = re.compile(
    r"\b(?:alabama|alaska|arizona|arkansas|california|colorado|connecticut|"
    r"delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|"
    r"kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|"
    r"mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|"
    r"new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|"
    r"pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|"
    r"utah|vermont|virginia|washington|west virginia|wisconsin|wyoming|"
    r"district of columbia)\b",
    re.IGNORECASE,
)
_US_STATE_CODE_PATTERN = re.compile(
    r"(?:^|[,\s])(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|"
    r"ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|"
    r"SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)(?=$|[,\s])"
)
_NON_TEXAS_STATE_PATTERN = re.compile(
    r",\s*(?!tx\b|texas\b)(?:[a-z]{2}|[a-z][a-z .'-]+)(?:\s+\d{5}(?:-\d{4})?)?\s*$",
    re.IGNORECASE,
)

_NON_TEXAS_STATE_CODES = (
    "AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|"
    "MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|UT|VT|"
    "VA|WA|WV|WI|WY|DC"
)
_STRONG_NON_TEXAS_LOCATION_PATTERN = re.compile(
    r"(?i:\b(?:position|role|job|candidate|employee|intern|engineer|team|office|site|"
    r"work(?:s|ing)?|based|located|report(?:s|ing)?|join)\b"
    r"[^.!?\n]{0,140}\b(?:in|at|near)\s+)"
    r"([A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*){0,3}),\s*"
    r"(?i:(" + _NON_TEXAS_STATE_CODES + r"))\b",
)
_LEGAL_LOCATION_CONTEXT_PATTERN = re.compile(
    r"\b(?:fair chance|criminal|conviction|arrest|ordinance|background inquir|applicable law)\b",
    re.IGNORECASE,
)


DFW_AREA_LABEL = "Dallas-Fort Worth area"
REMOTE_LABEL = "Remote"
# Display spellings for city names that str.title() would get wrong.
_CITY_DISPLAY_OVERRIDES = {"mckinney": "McKinney", "desoto": "DeSoto"}
_STATE_SUFFIX_PATTERN = re.compile(
    r"^(?:tx|texas)(?:\s+\d{5}(?:-\d{4})?)?$|^(?:united states(?: of america)?|u\.?s\.?a?\.?)$",
    re.IGNORECASE,
)


def _display_city(city: str) -> str:
    key = city.casefold()
    return _CITY_DISPLAY_OVERRIDES.get(key) or " ".join(word.capitalize() for word in key.split())


def market_area_label(location: object, work_style: object = "") -> str | None:
    """Return one honest, de-duplicated area label for market statistics.

    "Dallas", "dallas, texas", and "Dallas, TX 75201" all become "Dallas"
    because the posting names the city of Dallas itself. Regional wording
    ("DFW", "Dallas-Fort Worth Metroplex", "North Texas", "Dallas County") or a
    posting that lists several DFW cities becomes "Dallas-Fort Worth area",
    because we cannot tell which city the job is actually in.
    """
    text = " ".join(re.sub(r"\([^)]*\)", " ", str(location or "")).split())
    if _REMOTE_PATTERN.search(text) or (
        not text and _REMOTE_PATTERN.search(" ".join(str(work_style or "").split()))
    ):
        return REMOTE_LABEL

    parts = [part.strip() for part in text.split(",") if part.strip()]
    # Drop trailing ", TX" / ", Texas 75201" / ", United States" so "Dallas, Texas" -> ["Dallas"].
    while len(parts) > 1 and _STATE_SUFFIX_PATTERN.match(parts[-1]):
        parts.pop()

    if len(parts) == 1 and parts[0].casefold() in DFW_CITIES:
        return _display_city(parts[0])

    has_region = bool(_DFW_REGION_PATTERN.search(text))
    cities = {match.group(0).casefold() for match in _DFW_CITY_PATTERN.finditer(text)}
    if has_region or cities:
        return DFW_AREA_LABEL

    if not parts:
        return None
    # Outside DFW (Texas / nationwide scopes): keep the city name, normalized for casing.
    first = parts[0]
    return _display_city(first) if first.islower() or first.isupper() else first


def find_location_conflicts(description: object) -> tuple[str, ...]:
    """Return strong non-Texas workplace evidence found in source text.

    The context requirement avoids treating compensation disclaimers, travel,
    customer locations, or a company's headquarters as the job location.
    """
    text = " ".join(str(description or "").split())
    conflicts: list[str] = []
    for match in _STRONG_NON_TEXAS_LOCATION_PATTERN.finditer(text):
        context = text[max(0, match.start() - 160):min(len(text), match.end() + 160)]
        if _LEGAL_LOCATION_CONTEXT_PATTERN.search(context):
            continue
        evidence = f"{match.group(1).strip()}, {match.group(2).upper()}"
        if evidence.lower() not in {item.lower() for item in conflicts}:
            conflicts.append(evidence)
    return tuple(conflicts)


def assess_job_location(location: object, work_style: object = "") -> LocationDecision:
    """Accept only explicit DFW or explicit remote evidence.

    Remote is intentionally a separate category and never inferred from a DFW
    location. Search URLs are not inputs: a source result must stand on its own.
    """
    location_text = " ".join(str(location or "").split())
    work_style_text = " ".join(str(work_style or "").split())

    if _REMOTE_PATTERN.search(location_text) or _REMOTE_PATTERN.search(work_style_text):
        has_us_scope = bool(
            _US_COUNTRY_PATTERN.search(location_text)
            or _US_STATE_NAME_PATTERN.search(location_text)
            or _US_STATE_CODE_PATTERN.search(location_text)
        )
        if has_us_scope:
            return LocationDecision(True, "Remote", "explicit U.S. remote evidence")
        return LocationDecision(False, None, "remote role lacks explicit U.S. location evidence")

    location_text = re.sub(
        r",\s*(?:united states(?: of america)?|u\.?s\.?a?\.?)\s*$",
        "",
        location_text,
        flags=re.IGNORECASE,
    )

    if not location_text:
        return LocationDecision(False, None, "missing location evidence")

    if _NON_TEXAS_STATE_PATTERN.search(location_text):
        return LocationDecision(False, None, "location is outside Texas")

    if _DFW_REGION_PATTERN.search(location_text):
        return LocationDecision(True, "DFW", "DFW regional wording")

    city_match = _DFW_CITY_PATTERN.search(location_text)
    if city_match:
        return LocationDecision(True, "DFW", f"DFW city: {city_match.group(0)}")

    return LocationDecision(False, None, "location is not confidently DFW or Remote")


def assess_job_geography(
    location: object,
    work_style: object = "",
    description: object = "",
    scope: str = "dfw",
) -> LocationDecision:
    """Apply the complete shared feed policy, including source-text conflicts."""
    decision = assess_job_location(location, work_style)
    if not decision.accepted and scope in {"texas", "nationwide"}:
        text = " ".join(str(location or "").split())
        texas = bool(re.search(r"(?:,\s*TX\b|,\s*Texas\b|\bTexas\b)", text, re.I))
        us = bool(_US_STATE_CODE_PATTERN.search(text) or _US_STATE_NAME_PATTERN.search(text))
        if texas or (scope == "nationwide" and us):
            decision = LocationDecision(True, "Texas" if texas else "Relocation", "explicit US state location")
    if not decision.accepted or decision.category in {"Remote", "Texas", "Relocation"}:
        return decision

    conflicts = find_location_conflicts(description)
    if conflicts:
        return LocationDecision(
            False,
            None,
            f"DFW location conflicts with source evidence: {', '.join(conflicts)}",
        )
    return decision
