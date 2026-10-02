"""Turn parsed resume text into the education, work, and skills an application form asks for."""

from __future__ import annotations

MAX_ENTRIES = 4
MAX_SKILLS = 20


def _clean(value, limit: int) -> str:
    text = " ".join(str(value or "").split())
    return text[:limit]


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
    for entry in (source.get("experience_entries") or [])[:MAX_ENTRIES]:
        if not isinstance(entry, dict):
            continue
        company, title = split_experience_title(entry.get("title") or "")
        bullets = []
        for bullet in entry.get("bullets") or []:
            cleaned = _clean(bullet, 240)
            if cleaned and cleaned not in bullets:
                bullets.append(cleaned)
        description = "\n".join(bullets)[:1000]
        if not (company or title or description):
            continue
        experience.append({
            "company": company,
            "title": title,
            "location": "",
            "startDate": "",
            "endDate": "",
            "description": description,
            "current": False,
        })

    return {
        "skills": skills[:MAX_SKILLS],
        "education": education,
        "experience": experience,
    }
