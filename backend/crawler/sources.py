"""Bounded, maintainable production discovery configuration."""

from __future__ import annotations

from urllib.parse import urlencode


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
    "https://joinhandshake.com/internships/dallas-tx/",
    "https://joinhandshake.com/internships/dallas-tx/engineering/",
    "https://joinhandshake.com/internships/dallas-tx/data-science/",
    "https://joinhandshake.com/internships/role/computer-science/",
    "https://joinhandshake.com/internships/remote/engineering/",
    "https://joinhandshake.com/internships/remote/information-technology/",
)

# A search gets a modest share of the run so the first broad query cannot starve
# later specialties. Source ceilings bound scheduled request volume.
PER_SEARCH_ACCEPT_LIMIT = 20
DEFAULT_SOURCE_LIMITS = {"linkedin": 150, "handshake": 100, "all": 250}


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


def source_urls(source: str) -> list[tuple[str, str]]:
    urls: list[tuple[str, str]] = []
    # In a combined run, collect Handshake's smaller fixed public grids first;
    # otherwise LinkedIn can consume the entire combined ceiling by itself.
    if source in {"all", "handshake"}:
        urls.extend(("handshake", url) for url in HANDSHAKE_URLS)
    if source in {"all", "linkedin"}:
        urls.extend(("linkedin", url) for url in LINKEDIN_URLS)
    return urls
