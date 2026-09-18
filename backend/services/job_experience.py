"""Explainable internship and early-career eligibility checks."""

from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class ExperienceDecision:
    accepted: bool
    level: str | None
    reason: str


_SENIOR_TITLE = re.compile(
    r"\b(senior|sr\.?|staff|principal|lead|manager|director|architect|"
    r"head(?: of)?|chief|vice[ -]?president|vp|experienced)\b",
    re.IGNORECASE,
)
_INTERNSHIP_TITLE = re.compile(r"\b(intern(?:s|ship|ships)?|co[ -]?op)\b", re.IGNORECASE)
_ENTRY_TITLE = re.compile(
    r"\b(entry[ -]?level|junior|jr\.?|new grad(?:uate)?|college grad|graduate|"
    r"early career|associate|level 1|engineer i|developer i|sde i|amts)\b",
    re.IGNORECASE,
)
_YEARS_REQUIRED = re.compile(
    r"\b(?:minimum(?: of)?|at least|requires?|required|must have)\s+"
    r"(\d{1,2})(?:\s*\+)?\s+years?(?:\s+of)?\s+"
    r"(?:professional\s+|relevant\s+|related\s+|software\s+|engineering\s+|industry\s+|work\s+)?experience\b|"
    r"\b(\d{1,2})\+\s+years?(?:\s+of)?\s+"
    r"(?:professional\s+|relevant\s+|related\s+|software\s+|engineering\s+|industry\s+|work\s+)?experience\b",
    re.IGNORECASE,
)


def assess_job_experience(title: object, description: object = "", source_level: object = "") -> ExperienceDecision:
    title_text = " ".join(str(title or "").split())
    description_text = " ".join(str(description or "").split())
    level_text = str(source_level or "").strip().lower()

    if _SENIOR_TITLE.search(title_text):
        return ExperienceDecision(False, None, "senior-level title signal")
    if _INTERNSHIP_TITLE.search(title_text) or "intern" in level_text:
        return ExperienceDecision(True, "Internship", "internship title or source level")

    years = []
    for match in _YEARS_REQUIRED.finditer(description_text):
        value = match.group(1) or match.group(2)
        if value:
            years.append(int(value))
    # Values above 15 are generally company-history claims ("40+ years of
    # experience"), not credible candidate requirements.
    meaningful_years = [value for value in years if value <= 15]
    if meaningful_years and max(meaningful_years) >= 3:
        return ExperienceDecision(
            False, None, f"requires {max(meaningful_years)}+ years of experience"
        )

    if _ENTRY_TITLE.search(title_text) or any(token in level_text for token in ("entry", "junior")):
        return ExperienceDecision(True, "Entry level", "entry-level title or source level")
    return ExperienceDecision(False, None, "no internship or entry-level signal")
