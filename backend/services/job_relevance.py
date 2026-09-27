"""Conservative, explainable relevance checks for HireSense's technology feed."""

from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class RelevanceDecision:
    relevant: bool
    reason: str


TITLE_SIGNALS = {
    "software": r"\bsoftware\b",
    "software development": r"\bsoftware development\b",
    "developer": r"\b(developer|programmer|programming)\b",
    "computer science": r"\bcomputer science\b",
    "information technology": r"\b(information technology|IT (?:intern(?:ship)?|support|specialist|engineer|analyst|technician|developer)|technical support engineer)\b",
    "data engineering": r"\bdata engineer(?:ing)?\b",
    "data science": r"\bdata scien(?:ce|tist)\b",
    "cybersecurity": r"\b(cyber ?security|information security|security engineer)\b",
    "cloud": r"\bcloud\b",
    "devops": r"\bdevops\b",
    "platform/SRE": r"\b(platform engineer|site reliability|SRE)\b",
    "firmware/embedded": r"\b(firmware|embedded (?:software|systems?)|embedded engineer)\b",
    "web development": r"\b(web developer|web development)\b",
    "mobile development": r"\b(mobile developer|mobile development|android|ios developer)\b",
    "AI/ML": r"\b(artificial intelligence|machine learning|generative AI|large language model|LLM|NLP|AI(?:/ML)?|ML)(?: engineer| intern)?\b",
    "QA/software test": r"\b(quality assurance|software test|QA(?: engineer| intern)?|test automation)\b",
    "SDET": r"\bSDET\b",
    "application engineering": r"\b(application developer|application development|application engineer)\b",
    "full stack": r"\b(full[ -]?stack|front[ -]?end|back[ -]?end)\b",
    "database": r"\b(database|SQL developer)\b",
    "network engineering": r"\bnetwork engineer(?:ing)?\b",
    "technical systems": r"\bsystems engineer(?:ing)?\b",
    "technical solutions": r"\bsolutions engineer(?:ing)?\b",
}

DESCRIPTION_SIGNALS = {
    "software engineering": r"\bsoftware (?:engineer|engineering|developer|development)\b",
    "computer science": r"\bcomputer science\b",
    "information technology": r"\binformation technology\b",
    "data engineering/science": r"\bdata (?:engineer|engineering|science|scientist)\b",
    "cybersecurity": r"\b(cyber ?security|information security)\b",
    "cloud/devops": r"\b(cloud engineering|cloud infrastructure|devops)\b",
    "platform/SRE": r"\b(platform engineering|site reliability|SRE)\b",
    "firmware/embedded": r"\b(firmware|embedded software|embedded systems|microcontrollers?|RTOS)\b",
    "web/mobile": r"\b(web development|mobile development|android development|ios development)\b",
    "AI/ML": r"\b(artificial intelligence|machine learning|AI/ML)\b",
    "QA/software test": r"\b(quality assurance|software test|test automation)\b",
    "coding languages": r"\b(Python|JavaScript|TypeScript|Java|C\+\+|C#|\.NET|React|Node\.js)\b",
    "software delivery": r"\b(source control|Git|CI/CD|API development|API services|microservices|software lifecycle)\b",
    "database development": r"\b(database development|SQL development)\b",
}

HARD_NEGATIVE_TITLE_SIGNALS = {
    "photography": r"\bphotograph(?:y|er|ic)\b",
    "marketing": r"\bmarketing\b",
    "investment/finance": r"\b(investment|finance|financial analyst|wealth management)\b",
    "actuarial": r"\bactuarial\b",
    "sales": r"\bsales\b",
    "accounting": r"\baccount(?:ing|ant)\b",
    "human resources": r"\b(human resources|HR intern)\b",
    "recruiting": r"\b(recruit(?:er|ing)|talent acquisition)\b",
    "customer service": r"\b(customer service|customer support representative)\b",
    "operations": r"\b(?:business|store|warehouse|generic) operations\b",
    "supply chain": r"\bsupply chain\b",
}

CONDITIONAL_NEGATIVE_TITLE_SIGNALS = {
    "civil engineering": r"\bcivil engineer(?:ing)?\b",
    "field engineering": r"\bfield engineer(?:ing)?\b",
    "construction": r"\bconstruction\b",
    "mechanical engineering": r"\bmechanical engineer(?:ing)?\b",
    "manufacturing engineering": r"\bmanufacturing engineer(?:ing)?\b",
    "electrical engineering": r"\belectrical engineer(?:ing)?\b",
    "technician": r"\btechnician\b",
}

_SALES_ENGINEERING = re.compile(r"\b(?:sales engineer|solutions? consultant|pre[ -]?sales)\b", re.IGNORECASE)
_SOFTWARE_IN_TITLE = re.compile(
    r"\b(?:software|developer|firmware|embedded|devops|cloud|platform|SRE|data|machine learning|ML|AI|security|cyber|QA|SDET|automation)\b",
    re.IGNORECASE,
)


def _matches(patterns: dict[str, str], text: str) -> list[str]:
    return [name for name, pattern in patterns.items() if re.search(pattern, text, re.IGNORECASE)]


def assess_job_relevance(title: object, description: object = "") -> RelevanceDecision:
    title_text = " ".join(str(title or "").split())
    description_text = " ".join(str(description or "").split())
    if not title_text:
        return RelevanceDecision(False, "missing job title")

    hard_negative_matches = _matches(HARD_NEGATIVE_TITLE_SIGNALS, title_text)
    if hard_negative_matches:
        return RelevanceDecision(False, f"unrelated title signal: {hard_negative_matches[0]}")

    if _SALES_ENGINEERING.search(title_text) and not _SOFTWARE_IN_TITLE.search(title_text):
        return RelevanceDecision(False, "primarily sales engineering title")

    title_matches = _matches(TITLE_SIGNALS, title_text)
    if title_matches:
        if "technical systems" in title_matches or "technical solutions" in title_matches:
            description_matches = _matches(DESCRIPTION_SIGNALS, description_text)
            if len(description_matches) < 2:
                return RelevanceDecision(False, "ambiguous engineering title lacks software evidence")
        return RelevanceDecision(True, f"technology title signal: {title_matches[0]}")

    conditional_negative_matches = _matches(CONDITIONAL_NEGATIVE_TITLE_SIGNALS, title_text)
    if conditional_negative_matches:
        return RelevanceDecision(False, f"unrelated title signal: {conditional_negative_matches[0]}")
    description_matches = _matches(DESCRIPTION_SIGNALS, description_text)
    if len(description_matches) >= 2:
        return RelevanceDecision(
            True,
            "technology description signals: " + ", ".join(description_matches[:3]),
        )
    return RelevanceDecision(False, "no clear software/computing relevance")
