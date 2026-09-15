"""Extract skills from job descriptions with local JobBERT NER models."""

import hashlib
import os
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

DEFAULT_SKILL_MODEL = "jjzha/jobbert_skill_extraction"
DEFAULT_KNOWLEDGE_MODEL = "jjzha/jobbert_knowledge_extraction"
MAX_SOURCE_CHARS = 8000
MAX_LENGTH = 384
STRIDE = 80
MAX_SKILLS = 30
MAX_SKILL_WORDS = 4
DEFAULT_SCORE_THRESHOLD = 0.45
_CACHE_LIMIT = 400

# JobBERT sometimes tags generic HR phrasing; drop those so tags stay useful.
_SKILL_DENYLIST = {
    "ability",
    "abilities",
    "bachelor",
    "bachelors",
    "candidate",
    "candidates",
    "degree",
    "duties",
    "education",
    "equal opportunity",
    "experience",
    "experiences",
    "job",
    "knowledge",
    "opportunity",
    "position",
    "qualification",
    "qualifications",
    "requirement",
    "requirements",
    "responsibility",
    "responsibilities",
    "resume",
    "role",
    "scripts",
    "services",
    "skill",
    "skills",
    "software",
    "systems",
    "team player",
    "tools",
    "work",
}

_VERB_PREFIXES = {
    "build",
    "building",
    "deploy",
    "deploying",
    "develop",
    "developing",
    "using",
    "write",
    "writing",
}

try:
    from data.skills_catalog import SKILL_ALIASES, SKILL_ALLOWLIST
except ImportError:
    from backend.data.skills_catalog import SKILL_ALIASES, SKILL_ALLOWLIST

_models: Optional[Tuple[Any, Any, Any]] = None
_models_error: Optional[str] = None
_CACHE: Dict[str, List[str]] = {}
_CANONICAL_BY_KEY: Dict[str, str] = {}
_ALLOWLIST_PATTERNS: List[Tuple[str, re.Pattern]] = []


def _normalize_key(value: str) -> str:
    text = re.sub(r"\s+", " ", (value or "").strip().lower())
    text = (
        text.replace("node.js", "nodejs")
        .replace("c++", "cplusplus")
        .replace("c#", "csharp")
        .replace(".net", "dotnet")
        .replace("ci/cd", "cicd")
    )
    text = re.sub(r"[^a-z0-9\s]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    parts = text.split()
    if (
        parts
        and parts[-1].endswith("s")
        and len(parts[-1]) > 3
        and not parts[-1].endswith("ss")
    ):
        parts[-1] = parts[-1][:-1]
    return " ".join(parts)


def _compile_allowlist() -> None:
    _CANONICAL_BY_KEY.clear()
    _ALLOWLIST_PATTERNS.clear()
    for skill in SKILL_ALLOWLIST:
        _CANONICAL_BY_KEY[_normalize_key(skill)] = skill
        _ALLOWLIST_PATTERNS.append(
            (
                skill,
                re.compile(
                    r"(?<![A-Za-z0-9+#])" + re.escape(skill.lower()) + r"(?![A-Za-z0-9+#])",
                    re.IGNORECASE,
                ),
            )
        )
    for alias, canonical in SKILL_ALIASES.items():
        _CANONICAL_BY_KEY[_normalize_key(alias)] = canonical
    _ALLOWLIST_PATTERNS.sort(key=lambda item: len(item[0]), reverse=True)


_compile_allowlist()


def _env(name: str, default: str = "") -> str:
    return (os.getenv(name) or default).strip()


def _extraction_enabled() -> bool:
    raw = _env("EXTRACT_JOB_SKILLS", "true").lower()
    return raw not in {"0", "false", "no", "off"}


def _score_threshold() -> float:
    raw = _env("SKILL_SCORE_THRESHOLD", str(DEFAULT_SCORE_THRESHOLD))
    try:
        return float(raw)
    except ValueError:
        return DEFAULT_SCORE_THRESHOLD


def is_configured() -> bool:
    return _extraction_enabled() and _get_models() is not None


def _get_models():
    """Load tokenizer + both JobBERT heads once per process. Downloads on first use."""
    global _models, _models_error

    if _models is not None:
        return _models
    if _models_error is not None:
        return None

    try:
        import torch
        from transformers import AutoModelForTokenClassification, AutoTokenizer
    except ImportError as exc:
        _models_error = (
            "transformers is not installed. Run: pip install transformers torch"
        )
        print(f"[ai] {_models_error} ({exc})", flush=True)
        return None

    skill_model_name = _env("SKILL_MODEL", DEFAULT_SKILL_MODEL) or DEFAULT_SKILL_MODEL
    knowledge_model_name = (
        _env("KNOWLEDGE_MODEL", DEFAULT_KNOWLEDGE_MODEL) or DEFAULT_KNOWLEDGE_MODEL
    )
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(
        f"[ai] loading JobBERT skill={skill_model_name!r} "
        f"knowledge={knowledge_model_name!r} device={device} ...",
        flush=True,
    )
    try:
        tokenizer = AutoTokenizer.from_pretrained(knowledge_model_name)
        skill_model = AutoModelForTokenClassification.from_pretrained(skill_model_name)
        knowledge_model = AutoModelForTokenClassification.from_pretrained(
            knowledge_model_name
        )
        skill_model.to(device)
        knowledge_model.to(device)
        skill_model.eval()
        knowledge_model.eval()
    except Exception as exc:
        _models_error = str(exc)
        print(f"[ai] failed to load JobBERT: {exc}", flush=True)
        return None

    _models = (tokenizer, skill_model, knowledge_model)
    print("[ai] JobBERT ready", flush=True)
    return _models


def _clean_source(text: str) -> str:
    cleaned = re.sub(r"\s+", " ", (text or "").strip())
    cleaned = re.sub(
        r"(?i)\bequal opportunity employer\b.{0,240}",
        " ",
        cleaned,
    )
    return re.sub(r"\s+", " ", cleaned).strip()


def _normalize_bio_label(label: str) -> str:
    value = str(label).upper()
    if value in {"B", "I", "O"}:
        return value
    if value.startswith("B-") or value.endswith("-B") or value.startswith("B_"):
        return "B"
    if value.startswith("I-") or value.endswith("-I") or value.startswith("I_"):
        return "I"
    return "O"


def _windows(tokenizer, text: str) -> List[Dict[str, Any]]:
    encoded = tokenizer(
        text,
        truncation=True,
        max_length=MAX_LENGTH,
        stride=STRIDE,
        return_offsets_mapping=True,
        return_overflowing_tokens=True,
        return_attention_mask=True,
        padding=False,
        add_special_tokens=True,
    )
    input_ids = encoded["input_ids"]
    attention_mask = encoded["attention_mask"]
    offset_mapping = encoded["offset_mapping"]
    if input_ids and isinstance(input_ids[0], int):
        input_ids = [input_ids]
        attention_mask = [attention_mask]
        offset_mapping = [offset_mapping]
    return [
        {
            "input_ids": input_ids[index],
            "attention_mask": attention_mask[index],
            "offset_mapping": offset_mapping[index],
        }
        for index in range(len(input_ids))
    ]


def _predict_spans(text: str, tokenizer, model, threshold: float) -> List[Tuple[str, float]]:
    import torch

    device = next(model.parameters()).device
    id2label = {int(key): value for key, value in model.config.id2label.items()}
    spans: List[Tuple[str, float]] = []

    for window in _windows(tokenizer, text):
        input_ids = torch.tensor([window["input_ids"]], device=device)
        attention_mask = torch.tensor([window["attention_mask"]], device=device)
        offsets = window["offset_mapping"]

        with torch.no_grad():
            logits = model(input_ids=input_ids, attention_mask=attention_mask).logits[0]
        probs = torch.softmax(logits, dim=-1)
        pred_ids = logits.argmax(dim=-1).tolist()
        tokens = tokenizer.convert_ids_to_tokens(window["input_ids"])

        current_start: Optional[int] = None
        current_end: Optional[int] = None
        current_scores: List[float] = []

        def flush():
            nonlocal current_start, current_end, current_scores
            if current_start is None or current_end is None:
                return
            span = text[current_start:current_end]
            score = sum(current_scores) / len(current_scores) if current_scores else 0.0
            if score >= threshold:
                spans.append((span, score))
            current_start = None
            current_end = None
            current_scores = []

        for token_index, label_id in enumerate(pred_ids):
            if token_index >= len(offsets):
                break
            start, end = offsets[token_index]
            if start == end:
                continue
            if token_index < len(attention_mask[0]) and int(attention_mask[0][token_index]) == 0:
                continue

            label = _normalize_bio_label(id2label.get(int(label_id), "O"))
            score = float(probs[token_index][int(label_id)])
            token = tokens[token_index] if token_index < len(tokens) else ""
            is_subword = isinstance(token, str) and token.startswith("##")

            if is_subword and current_start is not None and start == current_end:
                current_end = end
                current_scores.append(score)
                continue

            if label == "B":
                # JobBERT often tags every WordPiece as B instead of B-I-I.
                if (
                    current_start is not None
                    and current_end is not None
                    and start == current_end
                ):
                    current_end = end
                    current_scores.append(score)
                else:
                    flush()
                    current_start = start
                    current_end = end
                    current_scores = [score]
            elif label == "I" and current_start is not None:
                current_end = end
                current_scores.append(score)
            else:
                flush()

        flush()

    return spans


def _clean_span(span: str) -> str:
    cleaned = re.sub(r"\s+", " ", (span or "").strip())
    cleaned = cleaned.strip(" \t,;:!?()[]{}\"'`")
    cleaned = re.sub(r"^[-–—/]+|[-–—/]+$", "", cleaned).strip()
    return cleaned


def _split_span(span: str) -> List[str]:
    cleaned = re.sub(r"\bskills?\b", " ", span, flags=re.I)
    cleaned = _clean_span(cleaned)
    if not cleaned:
        return []
    return [_clean_span(part) for part in re.split(r"\s+(?:and|&|/)\s+", cleaned, flags=re.I)]


def _is_useful_skill(span: str) -> bool:
    if not span or not re.search(r"[A-Za-z]", span):
        return False
    if len(span) > 60:
        return False
    words = span.split()
    if len(words) > MAX_SKILL_WORDS:
        return False
    lowered = span.lower()
    if lowered in _SKILL_DENYLIST:
        return False
    if len(span) == 1 and span.upper() not in {"C", "R"}:
        return False
    if words[0].lower() in _VERB_PREFIXES:
        return False
    return True


def _dedupe_skills(spans: List[Tuple[str, float]]) -> List[str]:
    ranked = sorted(spans, key=lambda item: item[1], reverse=True)
    chosen: List[str] = []
    seen = set()
    for raw_span, _score in ranked:
        for skill in _split_span(_clean_span(raw_span)):
            if not _is_useful_skill(skill):
                continue
            key = skill.lower()
            if key in seen:
                continue
            seen.add(key)
            chosen.append(skill)
            if len(chosen) >= MAX_SKILLS:
                return _drop_fragment_skills(chosen)
    return _drop_fragment_skills(chosen)


def _drop_fragment_skills(skills: List[str]) -> List[str]:
    compact = [re.sub(r"\s+", "", skill.lower()) for skill in skills]
    kept: List[str] = []
    for index, skill in enumerate(skills):
        key = compact[index]
        if len(key) < 4 and any(
            other != key and other.startswith(key) for other in compact
        ):
            continue
        kept.append(skill)
    return kept


def _unique_keep_order(values: List[str]) -> List[str]:
    seen = set()
    ordered: List[str] = []
    for value in values:
        key = _normalize_key(value)
        if not key or key in seen:
            continue
        seen.add(key)
        ordered.append(value)
        if len(ordered) >= MAX_SKILLS:
            break
    return ordered


def _catalog_skills_from_text(text: str) -> List[str]:
    lowered = (text or "").lower()
    return [skill for skill, pattern in _ALLOWLIST_PATTERNS if pattern.search(lowered)]


def _map_span_to_allowlist(span: str) -> List[str]:
    key = _normalize_key(span)
    if not key:
        return []
    canonical = _CANONICAL_BY_KEY.get(key)
    if canonical:
        return [canonical]

    hits: List[str] = []
    seen = set()
    lowered = span.lower()
    for skill, pattern in _ALLOWLIST_PATTERNS:
        if pattern.search(lowered) and skill not in seen:
            seen.add(skill)
            hits.append(skill)
    return hits


def _map_spans_to_allowlist(spans: List[str]) -> List[str]:
    mapped: List[str] = []
    for span in spans:
        mapped.extend(_map_span_to_allowlist(span))
    return _unique_keep_order(mapped)


def _company_keys(company: str) -> set:
    raw = _normalize_key(company)
    if not raw:
        return set()
    cleaned = re.sub(
        r"\b(inc|llc|ltd|corp|corporation|company|co|group|technologies|technology|labs|lab)\b",
        " ",
        raw,
    )
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    keys = {raw}
    if cleaned:
        keys.add(cleaned)
    tokens = cleaned.split()
    if tokens and len(tokens[0]) >= 4:
        keys.add(tokens[0])
    return {key for key in keys if key}


def _drop_company_skills(skills: List[str], company: Optional[str]) -> List[str]:
    blocked = _company_keys(company or "")
    if not blocked:
        return skills
    kept: List[str] = []
    for skill in skills:
        skill_key = _normalize_key(skill)
        if skill_key in blocked:
            continue
        if any(
            len(skill_key) >= 4
            and (skill_key in company_key or company_key in skill_key)
            for company_key in blocked
        ):
            continue
        kept.append(skill)
    return kept


def extract_job_skills(text: str, company: Optional[str] = None) -> List[str]:
    """Return allowlisted skills found in a job description."""
    raw = _clean_source(text)[:MAX_SOURCE_CHARS]
    if not raw:
        return []

    cache_key = hashlib.sha256(raw.encode("utf-8")).hexdigest()
    cached = _CACHE.get(cache_key)
    if cached is not None:
        return _drop_company_skills(list(cached), company)

    catalog_hits = _catalog_skills_from_text(raw)
    jobbert_hits: List[str] = []

    if _extraction_enabled():
        loaded = _get_models()
        if loaded is not None:
            tokenizer, skill_model, knowledge_model = loaded
            threshold = _score_threshold()
            try:
                spans = _predict_spans(raw, tokenizer, knowledge_model, threshold)
                spans.extend(_predict_spans(raw, tokenizer, skill_model, threshold))
                jobbert_hits = _map_spans_to_allowlist(_dedupe_skills(spans))
            except Exception as exc:
                print(f"[ai] JobBERT extract failed: {exc}", flush=True)

    skills = _unique_keep_order(jobbert_hits + catalog_hits)
    if len(_CACHE) >= _CACHE_LIMIT:
        _CACHE.pop(next(iter(_CACHE)))
    _CACHE[cache_key] = skills
    return _drop_company_skills(list(skills), company)


def extract_skills_for_jobs(jobs: List[Dict[str, Any]]) -> None:
    """Set job['skills'] from JobBERT spans filtered by the skill allowlist."""
    if not jobs:
        return

    for job in jobs:
        job.setdefault("skills", [])

    if not _extraction_enabled():
        print("[ai] JobBERT off; using skill allowlist only", flush=True)
    elif _get_models() is None:
        print("[ai] JobBERT unavailable; using skill allowlist only", flush=True)

    grouped: Dict[str, Dict[str, Any]] = {}
    for job in jobs:
        raw = (job.get("job_description") or "").strip()
        if not raw:
            job["skills"] = []
            continue
        key = hashlib.sha256(raw.encode("utf-8")).hexdigest()
        bucket = grouped.setdefault(key, {"raw": raw, "jobs": []})
        bucket["jobs"].append(job)

    items = list(grouped.values())
    print(
        f"[ai] extracting skills for {len(items)} unique job description(s)",
        flush=True,
    )

    for index, item in enumerate(items, start=1):
        mapped = extract_job_skills(item["raw"])
        for job in item["jobs"]:
            job["skills"] = _drop_company_skills(mapped, job.get("company"))
        if index % 5 == 0 or index == len(items):
            print(f"[ai] skill extract progress {index}/{len(items)}", flush=True)

    print(f"[ai] skill extraction done: unique={len(items)}", flush=True)


def backfill_job_skills(*, only_empty: bool = True) -> int:
    """Write JobBERT skills onto existing job_data rows."""
    try:
        from database.queries import fetch_jobs_for_skill_backfill, update_job_skills
    except ImportError:
        from backend.database.queries import (  # type: ignore
            fetch_jobs_for_skill_backfill,
            update_job_skills,
        )

    jobs = fetch_jobs_for_skill_backfill(only_empty=only_empty)
    if not jobs:
        print("[ai] no jobs need skill backfill", flush=True)
        return 0

    print(f"[ai] backfilling skills for {len(jobs)} job(s)", flush=True)
    extract_skills_for_jobs(jobs)

    updated = 0
    for job in jobs:
        job_id = job.get("id")
        skills = job.get("skills") or []
        if job_id is None:
            continue
        if only_empty and not skills:
            continue
        if update_job_skills(job_id, skills):
            updated += 1

    print(f"[ai] skill backfill updated {updated}/{len(jobs)} row(s)", flush=True)
    return updated


if __name__ == "__main__":
    backfill_job_skills(only_empty=False)
