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
