"""Bounded, maintainable production discovery configuration."""

from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import urlencode


@dataclass(frozen=True)
class SourceSpec:
    provider: str
    url: str
    company: str | None = None


LINKEDIN_DFW_KEYWORDS = (
    "software engineering intern",
    "software developer intern",
    "computer science intern",
    "information technology intern",
    "data engineer intern",
    "data science intern",
    "cybersecurity intern",
    "cloud intern",
    "devops intern",
    "AI intern",
    "machine learning intern",
    "QA software test intern",
    "junior software engineer",
    "entry level software engineer",
    "entry level developer",
    "new grad software engineer",
)

LINKEDIN_REMOTE_KEYWORDS = (
    "software engineering intern",
    "software developer intern",
    "data engineer intern",
    "data science intern",
    "cybersecurity intern",
    "cloud devops intern",
    "AI machine learning intern",
    "entry level software engineer",
)

HANDSHAKE_URLS = (
    "https://joinhandshake.com/internships/dallas-tx/artificial-intelligence/",
    "https://joinhandshake.com/internships/dallas-tx/computer-science/",
    "https://joinhandshake.com/internships/dallas-tx/data-science/",
    "https://joinhandshake.com/internships/dallas-tx/software-engineering/",
    "https://joinhandshake.com/internships/dallas-tx/information-technology/",
    "https://joinhandshake.com/internships/dallas-tx/cybersecurity/",
    "https://joinhandshake.com/internships/remote/computer-science/",
    "https://joinhandshake.com/internships/remote/data-science/",
    "https://joinhandshake.com/internships/remote/software-engineering/",
    "https://joinhandshake.com/internships/remote/information-technology/",
    "https://joinhandshake.com/internships/remote/cybersecurity/",
)

# A search gets a modest share of the run so the first broad query cannot starve
# later specialties. Source ceilings bound scheduled request volume.
PER_SEARCH_ACCEPT_LIMIT = 20
PER_SEARCH_TIME_LIMIT_SEC = 2 * 60
# The workflow runs LinkedIn, Handshake, and direct ATS feeds with a 45-minute cap.
# These hard source budgets leave at least ten minutes for setup and migrations.
DEFAULT_SOURCE_TIME_LIMITS_SEC = {
    "linkedin": 16 * 60,
    "handshake": 10 * 60,
    "ats": 6 * 60,
    "all": 32 * 60,
}
DEFAULT_SOURCE_LIMITS = {"linkedin": 150, "handshake": 100, "ats": 100, "all": 300}


def _linkedin_url(keywords: str, location: str, *, remote: bool = False) -> str:
    params = {"keywords": keywords, "location": location, "f_E": "1,2"}
    if remote:
        params["f_WT"] = "2"
    return "https://www.linkedin.com/jobs/search/?" + urlencode(params)


LINKEDIN_URLS = tuple(
    _linkedin_url(keyword, "Dallas-Fort Worth Metroplex")
    for keyword in LINKEDIN_DFW_KEYWORDS
) + tuple(
    _linkedin_url(keyword, "United States", remote=True)
    for keyword in LINKEDIN_REMOTE_KEYWORDS
)

# Public, unauthenticated company-operated ATS feeds. Each feed is one bounded
# request and every returned posting still passes HireSense's normal relevance,
# experience, geography, identity, deduplication, and lifecycle pipeline.
DIRECT_ATS_SOURCES = (
    SourceSpec("greenhouse", "https://boards-api.greenhouse.io/v1/boards/cloudflare/jobs?content=true", "Cloudflare"),
    SourceSpec("greenhouse", "https://boards-api.greenhouse.io/v1/boards/samsara/jobs?content=true", "Samsara"),
    SourceSpec("greenhouse", "https://boards-api.greenhouse.io/v1/boards/andurilindustries/jobs?content=true", "Anduril Industries"),
    SourceSpec("lever", "https://api.lever.co/v0/postings/zoox?mode=json", "Zoox"),
    SourceSpec("ashby", "https://api.ashbyhq.com/posting-api/job-board/Ramp?includeCompensation=true", "Ramp"),
    SourceSpec("ashby", "https://api.ashbyhq.com/posting-api/job-board/Vanta?includeCompensation=true", "Vanta"),
)


def source_specs(source: str) -> list[SourceSpec]:
    urls: list[SourceSpec] = []
    # In a combined run, collect Handshake's smaller fixed public grids first;
    # otherwise LinkedIn can consume the entire combined ceiling by itself.
    if source in {"all", "handshake"}:
        urls.extend(SourceSpec("handshake", url) for url in HANDSHAKE_URLS)
    if source in {"all", "linkedin"}:
        urls.extend(SourceSpec("linkedin", url) for url in LINKEDIN_URLS)
    if source in {"all", "ats"}:
        urls.extend(DIRECT_ATS_SOURCES)
    return urls


def source_urls(source: str) -> list[tuple[str, str]]:
    """Compatibility view used by existing callers and configuration tests."""
    return [(spec.provider, spec.url) for spec in source_specs(source)]
