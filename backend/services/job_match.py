"""Resume-to-job scoring used to rank a page before it is returned.

This follows the same rules as frontend/src/utils/jobMatcher.ts so list order
and match badges agree with the cards.
"""

from __future__ import annotations

import re

KNOWN_SKILLS = (
    "python",
    "java",
    "javascript",
    "typescript",
    "react",
    "node",
    "node.js",
    "express",
    "fastapi",
    "flask",
    "django",
    "spring",
    "sql",
    "mysql",
    "postgresql",
    "mongodb",
    "sql server",
    "sqlite",
    "oracle",
    "docker",
    "kubernetes",
    "aws",
    "azure",
    "gcp",
    "git",
    "github",
    "rest",
    "rest api",
    "api",
    "linux",
    "unix",
    "windows",
    "html",
    "css",
    "tailwind",
    "bootstrap",
    "pandas",
    "numpy",
    "tensorflow",
    "pytorch",
    "machine learning",
    "deep learning",
    "data analysis",
    "data analytics",
    "power bi",
    "tableau",
    "excel",
    "c",
    "c++",
    "c#",
    "go",
    "rust",
    "php",
    "ruby",
    "swift",
    "kotlin",
    "scala",
    "bash",
    "shell",
    "ci/cd",
    "azure devops",
    "github actions",
    "jira",
    "agile",
    "scrum",
    "unit testing",
    "pytest",
    "selenium",
    "playwright",
    "cloud",
    "microservices",
    "oop",
    "object oriented programming",
    "data structures",
    "algorithms",
)

DISPLAY_OVERRIDES = {
    "api": "API",
    "aws": "AWS",
    "azure": "Azure",
    "gcp": "GCP",
    "ci/cd": "CI/CD",
    "sql": "SQL",
    "mysql": "MySQL",
    "postgresql": "PostgreSQL",
    "mongodb": "MongoDB",
    "sqlite": "SQLite",
    "react": "React",
    "javascript": "JavaScript",
    "typescript": "TypeScript",
    "node": "Node.js",
    "node.js": "Node.js",
    "fastapi": "FastAPI",
    "flask": "Flask",
    "django": "Django",
    "python": "Python",
    "java": "Java",
    "c++": "C++",
    "c#": "C#",
    "html": "HTML",
    "css": "CSS",
    "docker": "Docker",
    "kubernetes": "Kubernetes",
    "github": "GitHub",
    "linux": "Linux",
    "unix": "Unix",
    "windows": "Windows",
    "pandas": "Pandas",
    "numpy": "NumPy",
    "tensorflow": "TensorFlow",
    "pytorch": "PyTorch",
    "pytest": "Pytest",
    "selenium": "Selenium",
    "playwright": "Playwright",
    "jira": "Jira",
    "agile": "Agile",
    "scrum": "Scrum",
    "excel": "Excel",
    "tableau": "Tableau",
    "power bi": "Power BI",
    "sql server": "SQL Server",
    "azure devops": "Azure DevOps",
    "github actions": "GitHub Actions",
    "rest api": "REST API",
    "rest": "REST",
    "oop": "OOP",
    "object oriented programming": "Object-Oriented Programming",
    "data structures": "Data Structures",
    "algorithms": "Algorithms",
    "machine learning": "Machine Learning",
    "deep learning": "Deep Learning",
    "data analysis": "Data Analysis",
    "data analytics": "Data Analytics",
}

_SKILL_PATTERNS = [
    (
        skill,
        re.compile(
            rf"(^|[^a-z0-9+#]){re.escape(skill)}([^a-z0-9+#]|$)",
            re.IGNORECASE,
        ),
    )
    for skill in KNOWN_SKILLS
]


def _normalize_skill(skill: str) -> str:
    return skill.strip().lower()


def _unique_normalized(values) -> list[str]:
    seen: list[str] = []
    found = set()
    for value in values or []:
        normalized = _normalize_skill(str(value))
        if normalized and normalized not in found:
            found.add(normalized)
            seen.append(normalized)
    return seen


def _to_display_case(skill: str) -> str:
    normalized = _normalize_skill(skill)
    if normalized in DISPLAY_OVERRIDES:
        return DISPLAY_OVERRIDES[normalized]
    return " ".join(part[:1].upper() + part[1:] if part else part for part in normalized.split(" "))


def _job_text(job: dict | None) -> str:
    if not job:
        return ""
    description = job.get("fullDescription") or ""
    if not description:
        raw = job.get("description")
        if isinstance(raw, str):
            description = raw
        elif isinstance(raw, dict):
            description = raw.get("about") or ""
    return " ".join([str(job.get("title") or ""), str(job.get("company") or ""), str(description)]).lower()


def _extract_skills_from_text(text: str) -> list[str]:
    if not text.strip():
        return []
    detected = []
    found = set()
    for skill, pattern in _SKILL_PATTERNS:
        if pattern.search(text) and skill not in found:
            found.add(skill)
            detected.append(skill)
    if re.search(r"\bnode\b", text, re.IGNORECASE) or re.search(r"\bnode\.js\b", text, re.IGNORECASE):
        if "node.js" not in found:
            detected.append("node.js")
    if re.search(r"\brestful\b", text, re.IGNORECASE) and "rest api" not in found:
        detected.append("rest api")
    if (
        re.search(r"\bms sql\b", text, re.IGNORECASE) or re.search(r"\bmicrosoft sql server\b", text, re.IGNORECASE)
    ) and "sql server" not in found:
        detected.append("sql server")
    return detected


def _job_skill_universe(job: dict | None) -> list[str]:
    direct = list(job.get("tags") or []) + list(job.get("skills") or []) if job else []
    return _unique_normalized([*direct, *_extract_skills_from_text(_job_text(job))])


def _recommendation(match_score: int) -> str:
    if match_score >= 85:
        return "Strong fit. Your resume aligns very well with this role\u2019s core skills and technologies."
    if match_score >= 70:
        return "Good fit. You already match many of the important skills, with a few smaller gaps to close."
    if match_score >= 50:
        return "Moderate fit. You have meaningful overlap, but tailoring your resume and strengthening the missing areas would help."
    if match_score >= 30:
        return "Partial fit. You match some relevant skills, but this role still has several important gaps."
    return "Low fit right now. This posting lists several skills that are not yet reflected strongly in your resume."


def match_resume_to_job(resume_data: dict | None, job: dict | None) -> dict:
    resume_skills = _unique_normalized((resume_data or {}).get("skills"))
    job_skills = _job_skill_universe(job)

    if not job_skills:
        return {
            "matchScore": 0,
            "matchedSkills": [],
            "missingSkills": [],
            "recommendation": "No job skills were available for matching yet. Add structured skills to the job data or improve the job parser.",
        }

    matched = [skill for skill in job_skills if skill in resume_skills]
    missing = [skill for skill in job_skills if skill not in resume_skills]
    coverage = len(matched) / len(job_skills)
    evidence_weight = min(1, len(job_skills) / 4)
    match_score = max(0, min(100, round(coverage * evidence_weight * 100)))
    matched.sort()
    missing.sort()
    return {
        "matchScore": match_score,
        "matchedSkills": [_to_display_case(skill) for skill in matched],
        "missingSkills": [_to_display_case(skill) for skill in missing],
        "recommendation": _recommendation(match_score),
    }
