"""Bounded, explainable candidate-to-job ranking; no hiring probabilities."""
from __future__ import annotations

import re
from collections import Counter
from datetime import datetime, timezone

from services.interview_context import safe_resume_context, safe_text
from services.job_listing import _parse_posted
from services.job_match import match_resume_to_job
from services.job_match import KNOWN_SKILLS
from services.job_location import assess_job_location


def coaching_signals_from_feedback(feedback_items: list[dict]) -> list[str]:
    """Only repeated, owned coaching gaps; never a hiring or match-score signal."""
    counts: Counter[str] = Counter()
    for feedback in feedback_items[:30]:
        text = ' '.join(safe_text(item, 400) for item in feedback.get('improvements', [])[:5])
        mentioned = {skill for skill in KNOWN_SKILLS if len(skill) >= 3 and
                     re.search(rf'(?<!\w){re.escape(skill)}(?!\w)', text, re.I)}
        counts.update(mentioned)
    return [f'Past interview coaching repeatedly flagged {skill.upper() if len(skill) <= 3 else skill} for preparation.'
            for skill, count in counts.most_common(3) if count >= 2]


def candidate_context(raw_resume: dict, coaching_signals: list[str] | None = None) -> dict:
    resume = safe_resume_context(raw_resume)
    entries = (resume['experience_entries'] + resume['project_entries'])[:6]
    return {
        'skills': resume['skills'][:30],
        'roles_and_projects': [{'title': item['title'], 'bullets': [safe_text(bullet, 220) for bullet in item['bullets'][:2]]} for item in entries],
        'education': resume['education'][:3],
        'coaching_signals': [safe_text(item, 150) for item in (coaching_signals or [])[:3]],
    }


def _evidence_for(skill: str, context: dict) -> str | None:
    needle = skill.casefold()
    for entry in context['roles_and_projects']:
        for bullet in entry['bullets']:
            if re.search(rf'(?<!\w){re.escape(needle)}(?!\w)', bullet.casefold()):
                return safe_text(f"{entry['title']}: {bullet}", 180)
    return None


def _freshness(job: dict, now: datetime) -> int:
    posted = _parse_posted(job.get('datePosted') or job.get('posted'), now)
    if posted is not None and posted <= now:
        days = (now - posted).days
        return 14 if days <= 1 else 9 if days <= 7 else 4 if days <= 30 else -10 if days > 90 else 0
    discovered = _parse_posted(job.get('firstSeenAt'), now)
    if discovered is None or discovered > now:
        return 0
    days = (now - discovered).days
    return 8 if days <= 1 else 5 if days <= 7 else 0


def _source_and_location(job: dict) -> int:
    source = str(job.get('source') or '').lower()
    source_points = 5 if source in {'greenhouse', 'lever', 'ashby'} else 4 if source == 'usajobs' else 2 if source == 'adzuna' else 0
    location = assess_job_location(job.get('location'), job.get('hybrid'))
    location_points = 9 if location.category == 'DFW' else 2 if location.category == 'Remote' else -5
    return source_points + location_points


def rank_recommendations(jobs: list[dict], context: dict, now: datetime | None = None, limit: int = 12) -> list[dict]:
    now = now or datetime.now(timezone.utc).replace(tzinfo=None)
    resume = {'skills': context['skills']}
    titles = ' '.join(item['title'] for item in context['roles_and_projects']).casefold()
    title_terms = {term for term in re.findall(r'[a-z]{4,}', titles) if term not in {'project', 'intern', 'engineer', 'software'}}
    ranked = []
    for job in jobs:
        match = match_resume_to_job(resume, job)
        matched = match['matchedSkills']
        if not matched:
            continue
        job_title = str(job.get('title') or '').casefold()
        title_overlap = bool(title_terms & set(re.findall(r'[a-z]{4,}', job_title)))
        freshness = _freshness(job, now)
        evidence_match = next(((skill, proof) for skill in matched[:5]
                               if (proof := _evidence_for(skill, context))), None)
        score = match['matchScore'] * .65 + min(12, len(matched) * 3) + (12 if title_overlap else 0) + freshness + _source_and_location(job)
        if job.get('experienceLevel') in ('Internship', 'Entry level'):
            score += 4
        if not job.get('applicationLink'):
            score -= 15
        priority = 'Strong fit' if score >= 65 and len(matched) >= 2 else 'Worth exploring' if score >= 35 else 'Stretch role'
        reason = (f"{matched[0]} appears in your resume and this posting."
                  if matched else 'Review the role requirements against your resume.')
        if evidence_match:
            reason = f"{evidence_match[0]} matches your resume evidence: {evidence_match[1]}"
        listed_skills = {str(skill).casefold() for skill in (job.get('tags') or [])}
        gap = next((skill for skill in match['missingSkills'] if skill.casefold() in listed_skills), None)
        preparation = next((signal for signal in context['coaching_signals']
                            if gap and gap.casefold() in signal.casefold()), None)
        ranked.append({**job, 'match': match['matchScore'], 'matchDetails': match,
                       'priority': priority, 'whyThisFits': reason, 'topGap': gap,
                       'preparationNote': preparation, '_rank': round(score, 2)})
    ranked.sort(key=lambda item: (-item['_rank'], -int(item.get('id') or 0)))
    return ranked[:limit]


def apply_bounded_rerank(candidates: list[dict], ordered_ids: list[int]) -> list[dict]:
    """The model may reorder only within deterministic ten-point bands."""
    if len(ordered_ids) != len(candidates) or set(ordered_ids) != {item['id'] for item in candidates}:
        return candidates
    order = {job_id: index for index, job_id in enumerate(ordered_ids)}
    return sorted(candidates, key=lambda item: (-int(item['_rank'] // 10), order[item['id']]))
