import json
import re
from typing import Any, Dict, List


def _normalize_skill(value: str) -> str:
    return value.strip().lower()


def _extract_job_skills(job: Dict[str, Any]) -> List[str]:
    raw_skills = job.get("skills") or job.get("tags") or []

    if isinstance(raw_skills, str):
        try:
            parsed = json.loads(raw_skills)
            if isinstance(parsed, list):
                raw_skills = parsed
            else:
                raw_skills = []
        except Exception:
            raw_skills = []

    cleaned: List[str] = []
    seen = set()

    for skill in raw_skills:
        skill_text = str(skill).strip()
        normalized = _normalize_skill(skill_text)
        if skill_text and normalized not in seen:
            cleaned.append(skill_text)
            seen.add(normalized)

    return cleaned


def _extract_resume_skills(resume_data: Dict[str, Any]) -> List[str]:
    skills = resume_data.get("skills", []) or []
    cleaned: List[str] = []
    seen = set()

    for skill in skills:
        skill_text = str(skill).strip()
        normalized = _normalize_skill(skill_text)
        if skill_text and normalized not in seen:
            cleaned.append(skill_text)
            seen.add(normalized)

    return cleaned


def _top_resume_project(resume_data: Dict[str, Any]) -> str:
    projects = resume_data.get("project_entries", []) or []
    if projects and isinstance(projects[0], dict):
        return projects[0].get("title", "one of your recent technical projects")
    projects = resume_data.get("projects", []) or []
    return str(projects[0]) if projects else "one of your recent technical projects"


def _top_resume_experience(resume_data: Dict[str, Any]) -> str:
    experiences = resume_data.get("experience_entries", []) or []
    if experiences and isinstance(experiences[0], dict):
        return experiences[0].get("title", "your recent experience")
    experiences = resume_data.get("experience", []) or []
    return str(experiences[0]) if experiences else "your recent experience"


def _description_text(job: Dict[str, Any]) -> str:
    description = job.get("job_description") or job.get("description") or ""

    if isinstance(description, dict):
        return str(description.get("about", "")).strip()

    return str(description).strip()


def _skill_is_askable(skill: str, description: str) -> bool:
    text = " ".join(str(skill or "").split())
    if not text or len(text) > 40 or not re.search(r"[A-Za-z]", text):
        return False
    lowered = text.lower()
    if lowered == "r":
        return True
    if lowered in {"c", "go"}:
        if lowered == "go":
            pattern = r"\b(?:golang|go\s+(?:language|programming))\b"
        else:
            pattern = r"\bc(?:\s+(?:language|programming))\b"
        return re.search(pattern, description, re.IGNORECASE) is not None
    return len(text) >= 2


def _first_askable(skills: List[str], description: str, fallback: str) -> str:
    for skill in skills:
        if _skill_is_askable(skill, description):
            return skill
    return fallback


def _speakable_label(value: str, fallback: str) -> str:
    text = " ".join(str(value or "").split())
    if "|" in text:
        text = text.split("|", 1)[0].strip()
    if not text or len(text) < 3 or len(text) > 80:
        return fallback
    return text


def _build_focus_skills(job: Dict[str, Any], resume_data: Dict[str, Any]) -> Dict[str, Any]:
    description = _description_text(job)
    job_skills = [skill for skill in _extract_job_skills(job) if _skill_is_askable(skill, description)]
    resume_skills = [skill for skill in _extract_resume_skills(resume_data) if _skill_is_askable(skill, description) or len(skill) > 2]

    resume_set = {_normalize_skill(skill) for skill in resume_skills}

    matched = [skill for skill in job_skills if _normalize_skill(skill) in resume_set]
    missing = [skill for skill in job_skills if _normalize_skill(skill) not in resume_set]

    primary = _first_askable(matched or job_skills or resume_skills, description, "a tool you have used")
    secondary_pool = [skill for skill in (matched[1:] or job_skills) if _normalize_skill(skill) != _normalize_skill(primary)]
    secondary = _first_askable(secondary_pool, description, "working with a team")
    gap = _first_askable(missing, description, "")

    return {
        "job_skills": job_skills,
        "resume_skills": resume_skills,
        "matched": matched,
        "missing": missing,
        "primary": primary,
        "secondary": secondary,
        "gap": gap,
    }


def generate_interview_questions(job: Dict[str, Any], resume_data: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Current MVP logic:
    - real backend-integrated
    - deterministic question generation
    - designed so a true LLM provider can replace this service later
    """
    title = job.get("job_title") or job.get("title") or "this role"
    company = job.get("company") or "the company"
    focus = _build_focus_skills(job, resume_data)
    project_title = _speakable_label(_top_resume_project(resume_data), "one of your projects")
    experience_title = _speakable_label(_top_resume_experience(resume_data), "your recent experience")

    gap_prompt = (
        f"One skill this role uses that is not obvious on your resume is {focus['gap']}. How would you ramp up quickly and still contribute early?"
        if focus["gap"]
        else "Which part of this role would you need to learn first, and how would you contribute while you ramp up?"
    )
    gap_focus = f"Growth Area: {focus['gap']}" if focus["gap"] else "Growth Area"

    questions = [
        {
            "question_id": "q1",
            "focus_area": "Role Fit",
            "prompt": f"Tell me about yourself and why your background is a strong fit for the {title} role at {company}.",
            "tips": [
                "Anchor your answer in relevant experience.",
                "Mention technical alignment to the role.",
                "Keep it concise and structured.",
            ],
            "target_keywords": [title, company, focus["primary"], experience_title],
        },
        {
            "question_id": "q2",
            "focus_area": f"Technical Depth: {focus['primary']}",
            "prompt": f"Walk me through a time you used {focus['primary']} in a project or internship. What was the problem, what did you build, and what was the result?",
            "tips": [
                "Use a problem → action → result flow.",
                "Mention tools, tradeoffs, and outcomes.",
                "Include one measurable impact if possible.",
            ],
            "target_keywords": [focus["primary"], "built", "result", "impact", "designed"],
        },
        {
            "question_id": "q3",
            "focus_area": f"Technical Depth: {focus['secondary']}",
            "prompt": f"This role emphasizes {focus['secondary']}. Tell me about a time you used it, and how you would apply it as a {title}.",
            "tips": [
                "Connect your answer to the role context.",
                "Show how you think technically.",
                "Be specific about decisions and reasoning.",
            ],
            "target_keywords": [focus["secondary"], title, "tradeoff", "approach", "reasoning"],
        },
        {
            "question_id": "q4",
            "focus_area": gap_focus,
            "prompt": gap_prompt,
            "tips": [
                "Be honest without underselling yourself.",
                "Describe how you learn fast.",
                "Show what you can contribute immediately.",
            ],
            "target_keywords": [focus["gap"] or title, "learn", "ramp", "contribute", "collaboration"],
        },
        {
            "question_id": "q5",
            "focus_area": "Project Storytelling",
            "prompt": f"If I asked you to pick one project from your resume — like {project_title} — which would you choose, and how does it prepare you for this role?",
            "tips": [
                "Pick a project with strong relevance.",
                "Connect the project to the job requirements.",
                "End by tying it back to the company or role.",
            ],
            "target_keywords": [project_title, title, company, focus["primary"], focus["secondary"]],
        },
    ]

    return questions


_FILLER_TERMS = {
    "built",
    "result",
    "impact",
    "designed",
    "tradeoff",
    "approach",
    "reasoning",
    "learn",
    "ramp",
    "contribute",
    "collaboration",
    "problem solving",
    "system design",
}

_DATE_TOKEN = re.compile(
    r"\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|"
    r"sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|present|current|20\d{2}|19\d{2})\b",
    re.IGNORECASE,
)
_CONTEXT = re.compile(
    r"\b(situation|problem|challenge|tasked|needed to|responsible|goal|requirement|bug|issue)\b",
    re.IGNORECASE,
)
_ACTION = re.compile(
    r"\b(built|designed|implemented|created|led|developed|decided|chose|wrote|fixed|migrated|owned|shipped|launched|automated|refactored)\b",
    re.IGNORECASE,
)
_RESULT = re.compile(
    r"\b(result|results|impact|outcome|so that|which led|as a result|improved|reduced|increased|learned|saved|cut|dropped|faster)\b",
    re.IGNORECASE,
)
_DECISION = re.compile(r"\b(because|decided|chose|tradeoff|trade-off|instead|compared)\b", re.IGNORECASE)
_MEASURED_IMPACT = re.compile(
    r"\b\d+(?:\.\d+)?\s*(?:%|percent|x)\b"
    r"|(?:improved|reduced|increased|saved|cut|decreased|grew|dropped|boosted).{0,48}\b\d+"
    r"|\b\d+(?:\.\d+)?(?:\s+\w+){0,4}\s*(?:%|percent)\b",
    re.IGNORECASE,
)
_QUALITATIVE_IMPACT = re.compile(
    r"\b(improved|reduced|increased|saved|faster|shipped|launched|learned|outcome|resulted|cut|dropped)\b",
    re.IGNORECASE,
)
_DIMENSION_ORDER = ("Relevance", "Structure", "Specificity", "Impact")
_DIMENSION_COPY = {
    "Relevance": (
        "You tied the answer to the question’s focus.",
        "Name the skill or situation the question asked about.",
    ),
    "Structure": (
        "The answer moves from the situation to what you did and what happened.",
        "Walk through the situation, what you did, and the result.",
    ),
    "Specificity": (
        "You included a concrete example instead of a general claim.",
        "Add a specific project, tool, or decision.",
    ),
    "Impact": (
        "You said what changed because of your work.",
        "Close with an outcome, even a rough one such as time saved or fewer bugs.",
    ),
}
_SUMMARY_BY_WEAKNESS = {
    "Relevance": "This answer stays general and does not address the focus of the question.",
    "Structure": "The points are relevant, but they are not told as a situation, an action, and a result.",
    "Specificity": "The answer matches the topic, but it needs a concrete example.",
    "Impact": "The example is specific, but it never says what changed because of your work.",
}


def _keyword_terms(question: Dict[str, Any]) -> List[str]:
    raw_terms: List[str] = []
    for keyword in question.get("target_keywords", []) or []:
        for segment in re.split(r"[|]", str(keyword)):
            segment = re.sub(r"\s+", " ", segment).strip(" -")
            if not segment or _DATE_TOKEN.search(segment) or re.search(r",\s*[A-Z]{2}\b", segment):
                continue
            if re.search(r"\bat\b", segment, re.IGNORECASE):
                segment = re.split(r"\bat\b", segment, maxsplit=1, flags=re.IGNORECASE)[0].strip()
            raw_terms.append(segment)

    focus = str(question.get("focus_area") or "")
    if ":" in focus:
        raw_terms.append(focus.split(":", 1)[1].strip())

    terms: List[str] = []
    seen = set()
    for term in raw_terms:
        cleaned = re.sub(r"\s+", " ", term).strip(" -")
        lowered = cleaned.lower()
        if not cleaned or lowered in _FILLER_TERMS or (len(lowered) < 3 and lowered not in {"r", "c", "go"}) or lowered in seen:
            continue
        seen.add(lowered)
        terms.append(cleaned)
    return terms


def _term_mentioned(term: str, answer: str) -> bool:
    if " " in term:
        return term.lower() in answer
    return re.search(rf"(?<!\w){re.escape(term)}(?!\w)", answer, re.IGNORECASE) is not None


def _benchmark(score: int) -> str:
    if score >= 85:
        return "Excellent"
    if score >= 70:
        return "Strong"
    if score >= 50:
        return "Developing"
    return "Needs work"


def _scale_dimensions(scores: List[int], total: int) -> List[int]:
    raw = sum(scores)
    if raw <= 0 or total == raw:
        return scores
    scaled = [int(score * total / raw) for score in scores]
    scaled[-1] += total - sum(scaled)
    return scaled


def evaluate_answer(question: Dict[str, Any], answer: str) -> Dict[str, Any]:
    answer_text = answer.strip()
    lowered = answer_text.lower()
    words = re.findall(r"\b[\w+]+\b", lowered)
    word_count = len(words)

    terms = _keyword_terms(question)
    matched = [term for term in terms if _term_mentioned(term, lowered)]
    hits = len(matched)

    if hits >= 3:
        relevance = 25
    elif hits == 2:
        relevance = 22
    elif hits == 1:
        relevance = 16
    elif not terms and word_count >= 40:
        relevance = 12
    else:
        relevance = 0

    parts = sum(1 for pattern in (_CONTEXT, _ACTION, _RESULT) if pattern.search(answer_text))
    if parts >= 3:
        structure = 25
    elif parts == 2:
        structure = 18
    elif parts == 1:
        structure = 10
    elif word_count >= 12:
        structure = 4
    else:
        structure = 0

    detail = 0
    if word_count >= 12 and hits:
        detail += 8
    if word_count >= 12 and _DECISION.search(answer_text):
        detail += 7
    detail = min(detail, 15)
    if word_count < 12:
        length_points = 0
    elif word_count < 30:
        length_points = 4
    elif word_count <= 180:
        length_points = 10
    elif word_count <= 260:
        length_points = 7
    else:
        length_points = 4
    specificity = detail + length_points

    if _MEASURED_IMPACT.search(answer_text):
        impact = 25
    elif _QUALITATIVE_IMPACT.search(answer_text):
        impact = 14
    else:
        impact = 0

    raw_scores = [relevance, structure, specificity, impact]
    total = sum(raw_scores)
    if not answer_text:
        total = 0
    elif word_count < 8:
        total = min(total, 12)
    elif word_count < 15:
        total = min(total, 30)
    total = max(0, min(total, 100))
    relevance, structure, specificity, impact = _scale_dimensions(raw_scores, total)

    dimensions = [
        {"label": label, "score": score, "max_score": 25}
        for label, score in zip(_DIMENSION_ORDER, (relevance, structure, specificity, impact))
    ]
    weakest = min(dimensions, key=lambda item: (item["score"], _DIMENSION_ORDER.index(item["label"])))

    strengths = [ _DIMENSION_COPY[item["label"]][0] for item in dimensions if item["score"] >= 18 ]
    improvements = [ _DIMENSION_COPY[item["label"]][1] for item in dimensions if item["score"] <= 12 ]
    if not improvements and total < 85:
        improvements.append(_DIMENSION_COPY[weakest["label"]][1])

    summary = (
        "This answer is specific, structured, and tied to the question."
        if total >= 85
        else _SUMMARY_BY_WEAKNESS[weakest["label"]]
    )

    return {
        "score": total,
        "benchmark": _benchmark(total),
        "summary": summary,
        "strengths": strengths[:3],
        "improvements": improvements[:3],
        "dimensions": dimensions,
    }


def build_final_result(responses: List[Dict[str, Any]]) -> Dict[str, Any]:
    if not responses:
        return {
            "final_score": 0,
            "overall_summary": "No interview responses were recorded.",
            "top_strengths": [],
            "next_steps": [],
        }

    scores = [int(response.get("score", 0)) for response in responses]
    final_score = round(sum(scores) / len(scores))

    buckets: Dict[str, List[int]] = {label: [] for label in _DIMENSION_ORDER}
    for response in responses:
        feedback = response.get("feedback", {})
        for item in feedback.get("dimensions", []) or []:
            label = str(item.get("label") or "")
            if label in buckets:
                buckets[label].append(int(item.get("score", 0)))

    dimensions = [
        {"label": label, "score": round(sum(values) / len(values)), "max_score": 25}
        for label in _DIMENSION_ORDER
        if (values := buckets[label])
    ]
    weakest = min(dimensions, key=lambda item: (item["score"], _DIMENSION_ORDER.index(item["label"]))) if dimensions else None
    strongest = max(dimensions, key=lambda item: (item["score"], -_DIMENSION_ORDER.index(item["label"]))) if dimensions else None

    top_strengths = [_DIMENSION_COPY[item["label"]][0] for item in dimensions if item["score"] >= 18]
    next_steps = [_DIMENSION_COPY[item["label"]][1] for item in dimensions if item["score"] <= 12]
    if not next_steps and weakest and final_score < 85:
        next_steps = [_DIMENSION_COPY[weakest["label"]][1]]

    if final_score >= 85:
        overall_summary = "Your answers were specific, structured, and tied to the questions."
    elif strongest and weakest:
        overall_summary = (
            f"Your strongest signal was {strongest['label'].lower()}. "
            f"{weakest['label']} is what held the score down."
        )
    else:
        overall_summary = "Your answers need a clearer example, a result, and a closer tie to each question."

    return {
        "final_score": final_score,
        "overall_summary": overall_summary,
        "top_strengths": top_strengths[:3],
        "next_steps": next_steps[:3],
        "dimensions": dimensions,
    }