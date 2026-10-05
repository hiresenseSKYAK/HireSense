"""Turn parsed resume text into the education, work, and skills an application form asks for."""

from __future__ import annotations

import re

MAX_ENTRIES = 4
MAX_SKILLS = 20
ISO_DATE = re.compile(r"\d{4}-\d{2}-\d{2}")


def _clean(value, limit: int) -> str:
    text = " ".join(str(value or "").split())
    return text[:limit]


def _iso_date(value) -> str:
    text = _clean(value, 10)
    return text if ISO_DATE.fullmatch(text) else ""


def split_experience_title(title: str) -> tuple[str, str]:
    """Return (company, job title) from a resume heading."""
    text = _clean(title, 200)
    lowered = text.lower()
    for marker in (" at ", " @ "):
        index = lowered.rfind(marker)
        if index > 0:
            return _clean(text[index + len(marker):], 120), _clean(text[:index], 120)
    for marker in (" | ", " — ", " – ", " - "):
        if marker in text:
            company, role = text.split(marker, 1)
            return _clean(company, 120), _clean(role, 120)
    return "", text


def build_applicant_profile(parsed: dict | None) -> dict:
    source = parsed or {}
    skills = [
        cleaned
        for skill in (source.get("skills") or [])
        if (cleaned := _clean(skill, 60))
    ]
    education = []
    structured_education = source.get("education_entries") or []
    if structured_education:
        for entry in structured_education:
            if not isinstance(entry, dict) or len(education) >= MAX_ENTRIES:
                continue
            current = bool(entry.get("current"))
            school = _clean(entry.get("school"), 200)
            degree = _clean(entry.get("degree"), 120)
            field = _clean(entry.get("fieldOfStudy"), 120)
            if not (school or degree or field):
                continue
            education.append({
                "school": school,
                "degree": degree,
                "fieldOfStudy": field,
                "startDate": _iso_date(entry.get("startDate")),
                "endDate": "" if current else _iso_date(entry.get("endDate")),
                "current": current,
            })
    else:
        for line in (source.get("education") or [])[:MAX_ENTRIES]:
            school = _clean(line, 200)
            if not school:
                continue
            education.append({
                "school": school,
                "degree": "",
                "fieldOfStudy": "",
                "startDate": "",
                "endDate": "",
                "current": False,
            })

    experience = []
    for entry in (source.get("experience_entries") or []):
        if not isinstance(entry, dict) or len(experience) >= MAX_ENTRIES:
            continue
        bullets = []
        for bullet in entry.get("bullets") or []:
            cleaned = _clean(bullet, 240)
            if cleaned and cleaned not in bullets:
                bullets.append(cleaned)
        description = "\n".join(bullets)[:1000]
        if "job_title" in entry or "startDate" in entry:
            current = bool(entry.get("current"))
            company = _clean(entry.get("company"), 120)
            title = _clean(entry.get("job_title"), 120)
        else:
            current = False
            company, title = split_experience_title(entry.get("title") or "")
        if not (company or title or description):
            continue
        experience.append({
            "company": company,
            "title": title,
            "location": _clean(entry.get("location"), 120),
            "startDate": _iso_date(entry.get("startDate")),
            "endDate": "" if current else _iso_date(entry.get("endDate")),
            "description": description,
            "current": current,
        })

    return {
        "skills": skills[:MAX_SKILLS],
        "education": education,
        "experience": experience,
    }
