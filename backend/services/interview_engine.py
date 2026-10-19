"""Provider-neutral interview orchestration. No credentials or vendor SDKs here."""
import json
import logging
import re
import time
import unicodedata
from difflib import SequenceMatcher
from typing import Annotated, Literal, Protocol

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from services.interview_context import safe_resume_context, safe_text

from services.interview_service import (
    _benchmark, _build_focus_skills, _description_text, _speakable_label,
    _top_resume_project, _DIMENSION_COPY, build_final_result, evaluate_answer, generate_interview_questions,
)

logger = logging.getLogger(__name__)
Mode = Literal['behavioral', 'technical', 'mixed', 'role_specific']
BriefText = Annotated[str, Field(min_length=1, max_length=1000)]


class ModelOutput(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True, str_strip_whitespace=True)


class Question(ModelOutput):
    focus_area: str = Field(min_length=1, max_length=120)
    prompt: str = Field(min_length=10, max_length=1000)
    tips: list[BriefText] = Field(default_factory=list, max_length=5)
    target_keywords: list[BriefText] = Field(default_factory=list, max_length=12)
    question_type: Mode = 'mixed'


class QuestionSet(ModelOutput):
    questions: list[Question] = Field(min_length=3, max_length=8)


class Dimension(ModelOutput):
    label: Literal['Relevance', 'Structure', 'Specificity', 'Impact']
    score: int = Field(ge=0, le=25)
    max_score: Literal[25] = 25


class Evaluation(ModelOutput):
    score: int = Field(ge=0, le=100)
    summary: str = Field(min_length=1, max_length=1000)
    strengths: list[BriefText] = Field(max_length=5)
    improvements: list[BriefText] = Field(max_length=5)
    dimensions: list[Dimension] = Field(min_length=4, max_length=4)
    technical_depth: str = Field(default='', max_length=1000)
    communication: str = Field(default='', max_length=1000)
    role_relevance: str = Field(default='', max_length=1000)
    evidence: list[BriefText] = Field(min_length=1, max_length=5)
    suggested_approach: str = Field(default='', max_length=1000)
    example_stronger_framing: str = Field(default='', max_length=1000)
    follow_up: str | None = None


class Debrief(ModelOutput):
    overall_summary: str = Field(min_length=1, max_length=1500)
    top_strengths: list[BriefText] = Field(max_length=5)
    next_steps: list[BriefText] = Field(max_length=5)
    technical_signals: str = Field(default='', max_length=1000)
    behavioral_signals: str = Field(default='', max_length=1000)
    communication_signals: str = Field(default='', max_length=1000)
    patterns_across_answers: list[BriefText] = Field(default_factory=list, max_length=5)
    practice_recommendations: list[BriefText] = Field(default_factory=list, max_length=5)
    job_readiness_areas: list[BriefText] = Field(default_factory=list, max_length=5)
    skill_gaps_exposed: list[BriefText] = Field(default_factory=list, max_length=5)
    recommended_next_session: str = Field(default='', max_length=500)
    personalized_action_plan: list[BriefText] = Field(default_factory=list, max_length=5)
    # Evidence is supplied by the server, never invented by the model.


class InterviewProvider(Protocol):
    """Adapters must enforce a finite timeout, return JSON objects, and avoid logging PII.

    Treat all context/answers as untrusted data, never as model instructions.
    See docs/ai-interview.md for output schemas and integration instructions.
    """
    def generate(self, context: dict) -> dict | str: ...
    def evaluate(self, context: dict, question: dict, answer: str, history: list[dict]) -> dict | str: ...
    def debrief(self, context: dict, responses: list[dict]) -> dict | str: ...


def questions_overlap(left, right):
    def normalized(value):
        return ' '.join(re.findall(r'[a-z]+', value.casefold()))
    a, b = normalized(left), normalized(right)
    return a == b or SequenceMatcher(None, a, b).ratio() >= 0.88


def followup_is_grounded(follow_up: str, answer: str) -> bool:
    ignored = {'about', 'after', 'could', 'describe', 'from', 'have', 'more', 'that', 'this', 'what', 'when',
               'where', 'which', 'with', 'would', 'your'}
    answer_terms = {term for term in re.findall(r'[a-z0-9+#.]+', answer.casefold())
                    if len(term) >= 3 and term not in ignored}
    followup_terms = {term for term in re.findall(r'[a-z0-9+#.]+', follow_up.casefold())
                      if len(term) >= 3 and term not in ignored}
    if answer_terms & followup_terms:
        return True
    triggers = (
        (r'\b\d+(?:\.\d+)?\s*(?:%|percent|x)?\b', r'\b(metric|measure|quantif|number|result|change)\w*\b'),
        (r'\b(we|team|group)\b', r'\b(you|your|personally|ownership|part|role)\b'),
        (r'\b(chose|selected|decided|used|built|implemented)\b', r'\b(why|trade.?off|alternative|reason)\w*\b'),
        (r'\b(test|validat|deploy|monitor|production)\w*\b', r'\b(test|validat|failure|measure|monitor|production)\w*\b'),
    )
    return any(re.search(signal, answer, re.I) and re.search(probe, follow_up, re.I)
               for signal, probe in triggers)


def _normalized_evidence(value: str) -> str:
    value = unicodedata.normalize('NFKC', value).casefold()
    value = value.translate(str.maketrans({'“': '"', '”': '"', '’': "'", '‘': "'", '—': '-', '–': '-'}))
    return ' '.join(re.findall(r'[\w+#]+', value, flags=re.UNICODE))


def evidence_is_grounded(evidence: str, answer: str) -> bool:
    """Accept faithful excerpts despite harmless quote, punctuation, case, or spacing drift."""
    needle = _normalized_evidence(evidence)
    return bool(needle) and needle in _normalized_evidence(answer)


def _unsupported_answer_claim(text: str, answer: str, allowed_numbers: set[str] | None = None) -> bool:
    """Catch invented numeric/technology claims without pretending to prove semantics."""
    from data.skills_catalog import SKILL_ALLOWLIST
    numbers = lambda value: set(re.findall(r'\b\d+(?:\.\d+)?%?\b', value))
    if not numbers(text) <= numbers(answer) | (allowed_numbers or set()):
        return True
    for skill in SKILL_ALLOWLIST:
        if len(skill) < 4 and skill not in {'AWS', 'GCP', 'SQL'}:
            continue
        pattern = rf'(?<!\w){re.escape(skill)}(?!\w)'
        if re.search(pattern, text, re.I) and not re.search(pattern, answer, re.I):
            # A gap suggestion is not a claim that the candidate used the skill.
            if re.search(r'\b(missing|lacks?|didn.t|not mentioned|consider|should|could|prepare|review)\b', text, re.I):
                continue
            return True
    return False


def normalize_evaluation(raw: dict, answer: str) -> tuple[dict | None, str, str]:
    """Keep valid core coaching while dropping ungrounded optional material."""
    if not isinstance(raw, dict) or not isinstance(raw.get('dimensions'), list):
        return None, 'invalid_dimensions', 'invalid'
    data = {key: raw[key] for key in Evaluation.model_fields if key in raw}
    dimensions = data['dimensions']
    labels = ('Relevance', 'Structure', 'Specificity', 'Impact')
    if len(dimensions) != 4 or not all(isinstance(item, dict) for item in dimensions):
        return None, 'invalid_dimensions', 'invalid'
    fixed_dimensions = []
    for item in dimensions:
        label = next((name for name in labels if str(item.get('label', '')).strip().casefold() == name.casefold()), None)
        score = item.get('score')
        if label is None or isinstance(score, bool) or not isinstance(score, int) or not 0 <= score <= 25:
            return None, 'invalid_dimensions', 'invalid'
        fixed_dimensions.append({'label': label, 'score': score, 'max_score': 25})
    if {item['label'] for item in fixed_dimensions} != set(labels):
        return None, 'invalid_dimensions', 'invalid'
    data['dimensions'] = fixed_dimensions
    derived_score = sum(item['score'] for item in fixed_dimensions)
    changes: set[str] = set()
    if data.get('score') != derived_score:
        data['score'] = derived_score
        changes.add('score_normalized')
    evidence = data.get('evidence')
    if not isinstance(evidence, list) or not evidence:
        return None, 'missing_evidence', 'invalid'
    grounded = [item.strip()[:1000] for item in evidence if isinstance(item, str) and evidence_is_grounded(item, answer)][:5]
    if not grounded:
        return None, 'ungrounded_evidence', 'invalid'
    if len(grounded) != len(evidence):
        changes.add('evidence_dropped')
    data['evidence'] = grounded
    for field in ('strengths', 'improvements'):
        bullets = data.get(field)
        if bullets is None:
            bullets = []
            changes.add('optional_bullet_defaulted')
        if not isinstance(bullets, list):
            return None, 'invalid_bullets', 'invalid'
        kept = [item.strip()[:1000] for item in bullets if isinstance(item, str) and item.strip()
                and not _unsupported_answer_claim(item, answer)][:5]
        if len(kept) != len(bullets):
            changes.add('optional_bullet_dropped')
        data[field] = kept
    summary = data.get('summary')
    if not isinstance(summary, str) or not summary.strip():
        return None, 'invalid_summary', 'invalid'
    if _unsupported_answer_claim(summary, answer, {str(derived_score), '100'}):
        return None, 'ungrounded_summary', 'invalid'
    if len(summary) > 1000:
        data['summary'] = summary[:1000].rstrip()
        changes.add('summary_trimmed')
    for field in ('technical_depth', 'communication', 'role_relevance', 'suggested_approach', 'example_stronger_framing'):
        value = data.get(field, '')
        if not isinstance(value, str) or _unsupported_answer_claim(value, answer):
            data[field] = ''
            changes.add('optional_text_dropped')
        elif len(value) > 1000:
            data[field] = value[:1000].rstrip()
            changes.add('optional_text_trimmed')
    follow_up = data.get('follow_up')
    if follow_up is not None and (not isinstance(follow_up, str) or not 10 <= len(follow_up) <= 600
                                  or not followup_is_grounded(follow_up, answer)
                                  or _unsupported_answer_claim(follow_up, answer)):
        data['follow_up'] = None
        changes.add('follow_up_dropped')
    try:
        result = Evaluation.model_validate(data).model_dump()
    except ValidationError:
        return None, 'schema_validation', 'invalid'
    if len(json.dumps(result).encode('utf-8')) > 6000:
        return None, 'storage_budget', 'invalid'
    if any('dropped' in change or 'defaulted' in change for change in changes):
        outcome = 'partial'
    elif changes:
        outcome = 'normalized'
    else:
        outcome = 'initial'
    return result, ','.join(sorted(changes)) or 'valid', outcome


def build_interview_plan(context: dict) -> list[dict]:
    """Create concise coverage metadata, not hidden model reasoning."""
    count = context['question_count']
    mode = context['mode']
    selected_focus = context.get('focus', [])
    primary = context['skills'].get('primary') or 'role fundamentals'
    gap = context['skills'].get('gap') or 'growth area'
    projects = context['resume'].get('project_entries', [])
    project = projects[0]['title'] if projects else 'resume evidence'
    technical = [
        ('project_ownership', project), ('technical_depth', primary), ('skill_gap', gap),
        ('debugging_tradeoffs', primary), ('testing_reliability', primary), ('system_design', primary),
        ('production_incident', primary), ('implementation_review', primary),
    ]
    behavioral = [
        ('ownership', project), ('storytelling', project), ('teamwork', 'collaboration'),
        ('adaptability', gap), ('outcomes_reflection', project), ('communication', 'role responsibilities'),
        ('conflict_resolution', 'collaboration'), ('learning', gap),
    ]
    if mode == 'technical':
        pool = technical
    elif mode == 'behavioral':
        pool = behavioral
    elif mode == 'role_specific':
        pool = [('role_responsibility', primary), *technical, *behavioral]
    else:
        pool = [technical[0], technical[1], behavioral[0], technical[2], technical[3], behavioral[2],
                behavioral[4], technical[4]]
    if selected_focus:
        pool = [('selected_focus', ', '.join(selected_focus[:3])), *pool]
    return [{'position': index + 1, 'target': target, 'anchor': safe_text(anchor, 120)}
            for index, (target, anchor) in enumerate(pool[:count])]


def interview_context(job: dict, resume: dict, mode: str, count: int,
                      difficulty: str = 'realistic', focus: list[str] | None = None) -> dict:
    resume = safe_resume_context(resume)
    skill_focus = _build_focus_skills(job, resume)
    skill_focus = {key: [safe_text(v, 100) for v in value[:50]] if isinstance(value, list) else safe_text(value, 100)
                   for key, value in skill_focus.items()}
    description = safe_text(_description_text(job), 12000)
    context = {
        'job': {key: safe_text(job.get(key), 500) for key in (
            'job_title', 'company', 'location', 'job_type', 'experience_level', 'work_style')},
        'description': description, 'skills': skill_focus, 'resume': resume, 'mode': mode,
        'difficulty': difficulty, 'focus': [safe_text(item, 80) for item in (focus or [])[:3]],
        'question_count': count,
        'count_semantics': 'total_turns',
    }
    context['interview_plan'] = build_interview_plan(context)
    return context


def fallback_evaluation(question, answer):
    result = evaluate_answer(question, answer)
    kind = question.get('question_type', 'mixed')
    scores = {d['label']: d['score'] for d in result['dimensions']}
    if kind == 'technical':
        reasoning = bool(re.search(r'\b(because|trade.?off|alternative|assum|instead|chose|constraint|if)\w*\b', answer, re.I))
        mechanism = bool(re.search(r'\b(test|index|cache|complexity|latency|validat|failure|edge case|algorithm|transaction|query|benchmark|memory)\w*\b', answer, re.I))
        scores['Structure'] = min(25, 10 * reasoning + 10 * mechanism + (5 if len(answer.split()) >= 30 else 0))
        scores['Specificity'] = min(25, scores['Specificity'] + 5 * mechanism)
        if re.search(r'\b(test|validat|benchmark|assert|monitor)\w*\b', answer, re.I):
            scores['Impact'] = max(scores['Impact'], 18)
    elif kind == 'behavioral':
        # Narrative relevance does not require repeating the resume's project name.
        if re.search(r'\b(I|my)\b', answer) and re.search(r'\b(team|feedback|priority|conflict|decision|help|led|owned|built|task|challenge)\w*\b', answer, re.I):
            scores['Relevance'] = max(scores['Relevance'], 18)
        if re.search(r'\b(learned|reflect|next time|changed my|feedback)\b', answer, re.I):
            scores['Impact'] = max(scores['Impact'], 18)
    result['dimensions'] = [dict(d, score=scores[d['label']]) for d in result['dimensions']]
    total = sum(scores.values())
    if len(answer.split()) < 8:
        total = min(12, total)
        from services.interview_service import _scale_dimensions
        scaled = _scale_dimensions(list(scores.values()), total)
        result['dimensions'] = [dict(d, score=score) for d, score in zip(result['dimensions'], scaled)]
    result['score'] = total
    result['benchmark'] = _benchmark(total)
    rubric = ('reasoning, technical specifics and validation' if kind == 'technical' else
              'personal ownership, specific examples, outcomes and reflection' if kind == 'behavioral' else
              'relevance, structure, specific examples and outcomes')
    weakest = min(result['dimensions'], key=lambda d: d['score'])['label']
    result['summary'] = f'Practice signals for {rubric}: {total}/100. Focus next on {weakest.lower()}.'
    result['strengths'] = [_DIMENSION_COPY[d['label']][0] for d in result['dimensions'] if d['score'] >= 18][:3]
    result['improvements'] = [_DIMENSION_COPY[d['label']][1] for d in result['dimensions'] if d['score'] <= 12][:3]
    if kind == 'technical' and scores['Structure'] <= 12:
        result['improvements'] = ['Explain assumptions, alternatives and why the approach fits the constraints.'] + result['improvements'][:2]
    # Literal excerpts are evidence of communication signals, not proof of correctness.
    result['evidence'] = [sentence.strip()[:500] for sentence in re.split(r'(?<=[.!?])\s+', answer)
                          if re.search(r'\b(built|chose|because|tested|reduced|learned|led|owned)\b', sentence, re.I)][:3]
    return result


class InterviewEngine:
    def __init__(self, provider: InterviewProvider | None = None, *, allow_repair: bool = True):
        self.provider = provider
        self.allow_repair = allow_repair
        self.repair_attempts = 0
        self._last_reason: str | None = None

    def _diagnostic(self, operation: str, outcome: str, reason: str | None = None):
        logger.info(
            'interview_provider operation=%s provider=%s model=%s outcome=%s%s',
            operation, getattr(self.provider, 'provider_name', 'openai' if self.provider else 'none'),
            getattr(self.provider, 'model', 'unknown'), outcome,
            f' reason={reason}' if reason else '',
        )

    def _call(self, method, schema, *args):
        if self.provider is None:
            self._last_reason = 'provider_unconfigured'
            self._diagnostic(method, 'fallback', self._last_reason)
            return None
        started = time.monotonic()
        try:
            raw = getattr(self.provider, method)(*args)
            if isinstance(raw, str):
                if len(raw.encode('utf-8')) > 24000:
                    raise ValueError('Provider response exceeds input limit.')
                raw = json.loads(raw)
            result = schema.model_validate(raw).model_dump() if schema is not None else raw
            if not isinstance(result, dict) or not result:
                raise ValueError('Provider returned no usable object.')
            limit = 24000 if schema is QuestionSet or schema is None else 6000
            if len(json.dumps(result).encode('utf-8')) > limit:
                raise ValueError('Provider output exceeds the storage budget.')
            self._last_reason = None
            return result
        except Exception as error:
            from services.interview_provider import provider_reason_code
            if isinstance(error, ValidationError):
                reason = 'schema_validation'
            else:
                reason = provider_reason_code(error)
            self._last_reason = reason
            # Never log provider errors verbatim: they can contain answers or credentials.
            logger.warning(
                'interview_provider operation=%s provider=%s model=%s outcome=fallback reason=%s '
                'duration_ms=%d exception=%s',
                method, getattr(self.provider, 'provider_name', 'configured'),
                getattr(self.provider, 'model', 'unknown'), reason,
                round((time.monotonic() - started) * 1000),
                type(error).__name__,
            )
            return None

    def questions(self, job, resume, mode='mixed', count=5, difficulty='realistic', focus=None):
        context = interview_context(job, resume, mode, count, difficulty, focus)
        generated = self._call('generate', QuestionSet, context)
        source = 'ai'
        if generated and len(generated['questions']) == count:
            questions = generated['questions']
            if any(questions_overlap(q['prompt'], previous['prompt'])
                   for i, q in enumerate(questions) for previous in questions[:i]):
                self._last_reason = 'duplicate_questions'
                generated = None
            if mode != 'mixed' and any(q['question_type'] != mode for q in questions):
                # The selected mode is server-authoritative; repairing this label is safe.
                for question in questions:
                    question['question_type'] = mode
        else:
            if generated is not None:
                self._last_reason = 'semantic_validation'
            generated = None
        if generated is None:
            if self.provider is not None and self._last_reason:
                self._diagnostic('questions', 'fallback', self._last_reason)
            source = 'fallback'
            questions = generate_interview_questions(job, resume)
            focus = context['skills']['primary']
            project = _speakable_label(_top_resume_project(resume), 'a recent project')
            extra = [
                ('Collaboration', 'Describe a disagreement on a team. How did you resolve it, and what changed?'),
                ('Tradeoffs', f'For {project}, what alternatives did you consider and why did you choose your approach?'),
                ('Reliability', f'How would you test and troubleshoot a solution using {focus} for this role?'),
            ]
            questions += [dict(focus_area=f, prompt=p, tips=['Explain your reasoning and outcome.'], target_keywords=[focus]) for f, p in extra]
            if mode == 'behavioral':
                prompts = [
                    'Tell me about a time you took ownership of a difficult task. What was the outcome?',
                    'Describe a time priorities changed. How did you adapt and communicate?',
                    'Tell me about feedback you received and how you acted on it.',
                    'Describe a setback. What did you learn and change afterward?',
                    f'Tell me about teamwork on {project}. What was your contribution?',
                    extra[0][1],
                    'Describe a decision made with incomplete information. How did you manage the risk?',
                    'Tell me about helping someone succeed. What was the result?',
                ]
                for q, prompt in zip(questions, prompts):
                    q.update(prompt=prompt + f' Use an example relevant to {context["job"]["job_title"]} or {project}.', focus_area='Behavioral', target_keywords=[project], tips=['Explain your own contribution, the outcome and what you learned.'])
            elif mode == 'technical':
                technical_prompts = [
                        "how would you design a solution to a problem from your recent work?",
                        "what did you build and how did you validate correctness?",
                        "how would you diagnose a slow or failing component?",
                        "what tradeoffs would you make when scaling a solution?",
                        "how did you apply it in " + project + "?",
                        "how would you test edge cases and failures?",
                        "what alternatives would you consider and why?",
                        "how would you measure reliability and performance?",
                ]
                for i, q in enumerate(questions):
                    q.update(prompt=f'Using {focus}, {technical_prompts[i]}', focus_area=f'Technical Depth: {focus}', target_keywords=[focus], tips=['Explain assumptions, alternatives, implementation and validation.'])
            elif mode == 'role_specific':
                for q in questions:
                    q['prompt'] += f" Connect your answer to the {context['job']['job_title']} responsibilities."
            questions = questions[:count]
        else:
            self._diagnostic('questions', 'accepted')
        if mode == 'mixed' and source == 'fallback':
            for i, q in enumerate(questions):
                q['question_type'] = 'technical' if i in (1, 2, 7) else 'behavioral' if i == 5 else 'role_specific'
        return [dict(q, question_id=f'q{i + 1}', source=source, mode=mode,
                     question_type=(q.get('question_type', mode) if mode == 'mixed' else mode), is_follow_up=False, parent_question_id=None)
                for i, q in enumerate(questions)]

    def feedback(self, context, question, answer, history):
        raw = self._call('evaluate', None, context, question, answer, history)
        result, reason, outcome = normalize_evaluation(raw, answer) if raw else (None, self._last_reason or 'provider_failure', 'invalid')
        if result:
            self._diagnostic('evaluate', f'evaluation_{outcome}_accepted', reason)
            return dict(result, benchmark=_benchmark(result['score']), source='ai')
        self._last_reason = reason
        # Only semantic/schema defects in an otherwise grounded provider response can
        # warrant another billed request. Transport failures, refusals, and wholly
        # invented evidence never enter this path.
        repair = getattr(type(self.provider), 'repair_evaluation', None) if self.provider is not None else None
        repairable = isinstance(raw, dict) and reason not in {'invalid_dimensions', 'missing_evidence', 'ungrounded_evidence'}
        if self.allow_repair and callable(repair) and repairable:
            self.repair_attempts += 1
            self._diagnostic('evaluate', 'evaluation_repair_attempted', reason)
            repaired = self._call('repair_evaluation', None, context, question, answer, history, raw)
            candidate, repair_reason, _ = normalize_evaluation(repaired, answer) if repaired else (None, self._last_reason or 'repair_provider_failure', 'invalid')
            if candidate:
                self._diagnostic('evaluate', 'evaluation_repair_accepted', repair_reason)
                return dict(candidate, benchmark=_benchmark(candidate['score']), source='ai')
            self._last_reason = repair_reason
            self._diagnostic('evaluate', 'evaluation_repair_failed', repair_reason)
        if self.provider is not None and self._last_reason:
            self._diagnostic('evaluate', 'evaluation_fallback', self._last_reason)
        result = fallback_evaluation(question, answer)
        weakest = min(result['dimensions'], key=lambda d: d['score'])['label']
        followups = {
            'Relevance': 'How does that example connect to the skill or responsibility in the question?',
            'Structure': 'What was the problem, what did you personally do, and what happened afterward?',
            'Specificity': 'Can you describe one concrete decision you made and why you chose that approach?',
            'Impact': 'What changed because of your work, and how did you observe or measure that outcome?',
        }
        # Probe the actual response; avoid vague/irrelevant replies that give no useful claim.
        probe = None
        if 8 <= len(answer.split()) and result['score'] < 70:
            excerpt = safe_text(answer, 120)
            probe = f'You mentioned “{excerpt}”. {followups[weakest]}'
        return dict(result, source='fallback',
                    technical_depth='Heuristic feedback cannot verify technical correctness.',
                    communication=result['summary'], role_relevance=result['improvements'][0] if result['improvements'] else 'You connected your example to the question.',
                    suggested_approach=('Explain assumptions, tradeoffs, implementation, validation and limitations.'
                                        if question.get('question_type') == 'technical' else
                                        'Use a specific situation, your own actions, the outcome and what you learned.'),
                    follow_up=probe)

    def final(self, context, responses):
        result = build_final_result(responses)
        result['overall_band'] = _benchmark(result['final_score'])
        generated = self._call('debrief', Debrief, context, responses)
        if generated:
            transcript_numbers = set(re.findall(r'\b\d+(?:\.\d+)?%?\b',
                                                ' '.join(r.get('answer', '') for r in responses)))
            generated_numbers = set(re.findall(r'\b\d+(?:\.\d+)?%?\b', json.dumps(generated)))
            if not generated_numbers <= transcript_numbers:
                self._last_reason = 'evidence_validation'
                generated = None
        if generated:
            self._diagnostic('debrief', 'accepted')
        elif self.provider is not None and self._last_reason:
            self._diagnostic('debrief', 'fallback', self._last_reason)
        result.update(generated or {})
        result.update(source='ai' if generated else 'fallback',
                      resume_evidence=[e['title'] for e in context['resume']['project_entries'] + context['resume']['experience_entries']
                                       if e['title'] and any(e['title'].casefold() in r.get('answer', '').casefold() for r in responses)][:5],
                      strongest_questions=[r['question_prompt'][:500] for r in sorted(responses, key=lambda r: r['score'], reverse=True)[:2]],
                       practice_questions=[r['question_prompt'][:500] for r in sorted(responses, key=lambda r: r['score'])[:3]])
        def response_reference(r):
            return {'question': r['question_prompt'][:500], 'answer_excerpt': r.get('answer', '')[:500], 'score': r['score']}
        ordered = sorted(responses, key=lambda r: r['score'])
        result.update(strongest_responses=[response_reference(r) for r in ordered[-2:][::-1]],
                      weakest_responses=[response_reference(r) for r in ordered[:2]],
                      specificity_needs=list(dict.fromkeys(
                          improvement for r in responses for improvement in r.get('feedback', {}).get('improvements', [])))[:5])
        if not generated:
            result.update(technical_signals='Review technical correctness separately; these scores measure answer signals.',
                           behavioral_signals='Review ownership, actions, outcomes, and reflection in each example.',
                          communication_signals=result['overall_summary'], patterns_across_answers=[],
                          practice_recommendations=result.get('next_steps', []))
        # Keep cached final answer + debrief within existing MySQL TEXT storage.
        # These are display excerpts; full answers remain in their response records.
        for key in ('strongest_responses', 'weakest_responses'):
            for item in result[key]:
                item['answer_excerpt'] = item['answer_excerpt'][:200]
                item['question'] = item['question'][:200]
        for key in ('resume_evidence', 'strongest_questions', 'practice_questions', 'specificity_needs',
                    'patterns_across_answers', 'practice_recommendations', 'job_readiness_areas',
                    'skill_gaps_exposed', 'personalized_action_plan'):
            result.setdefault(key, [])
            result[key] = [item[:200] for item in result[key]]
        return result
