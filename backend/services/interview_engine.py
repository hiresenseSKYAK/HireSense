"""Provider-neutral interview orchestration. No credentials or vendor SDKs here."""
import json
import logging
import re
from difflib import SequenceMatcher
from typing import Annotated, Literal, Protocol

from pydantic import BaseModel, ConfigDict, Field, model_validator

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
    follow_up: str | None = Field(default=None, min_length=10, max_length=600)

    @model_validator(mode='after')
    def consistent_scores(self):
        if len({d.label for d in self.dimensions}) != 4 or sum(d.score for d in self.dimensions) != self.score:
            raise ValueError('Dimensions must be unique and sum to the score.')
        return self


class Debrief(ModelOutput):
    overall_summary: str = Field(min_length=1, max_length=1500)
    top_strengths: list[BriefText] = Field(max_length=5)
    next_steps: list[BriefText] = Field(max_length=5)
    technical_signals: str = Field(default='', max_length=1000)
    communication_signals: str = Field(default='', max_length=1000)
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


def interview_context(job: dict, resume: dict, mode: str, count: int) -> dict:
    resume = safe_resume_context(resume)
    focus = _build_focus_skills(job, resume)
    focus = {key: [safe_text(v, 100) for v in value[:50]] if isinstance(value, list) else safe_text(value, 100)
             for key, value in focus.items()}
    description = safe_text(_description_text(job), 12000)
    return {
        'job': {key: safe_text(job.get(key), 500) for key in (
            'job_title', 'company', 'location', 'job_type', 'experience_level', 'work_style')},
        'description': description,
        'skills': focus, 'resume': resume, 'mode': mode, 'question_count': count,
        'count_semantics': 'total_turns',
    }


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
    def __init__(self, provider: InterviewProvider | None = None):
        self.provider = provider

    def _call(self, method, schema, *args):
        if self.provider is None:
            return None
        try:
            raw = getattr(self.provider, method)(*args)
            if isinstance(raw, str):
                if len(raw.encode('utf-8')) > 24000:
                    raise ValueError('Provider response exceeds input limit.')
                raw = json.loads(raw)
            result = schema.model_validate(raw).model_dump()
            limit = 24000 if schema is QuestionSet else 6000
            if len(json.dumps(result).encode('utf-8')) > limit:
                raise ValueError('Provider output exceeds the storage budget.')
            return result
        except Exception as error:
            # Never log provider errors verbatim: they can contain answers or credentials.
            logger.warning('Interview provider %s failed (%s); using fallback', method, type(error).__name__)
            return None

    def questions(self, job, resume, mode='mixed', count=5):
        context = interview_context(job, resume, mode, count)
        generated = self._call('generate', QuestionSet, context)
        source = 'ai'
        if generated and len(generated['questions']) == count:
            questions = generated['questions']
            if any(questions_overlap(q['prompt'], previous['prompt'])
                   for i, q in enumerate(questions) for previous in questions[:i]):
                generated = None
            if mode != 'mixed' and any(q['question_type'] != mode for q in questions):
                generated = None
        else:
            generated = None
        if generated is None:
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
        if mode == 'mixed' and source == 'fallback':
            for i, q in enumerate(questions):
                q['question_type'] = 'technical' if i in (1, 2, 7) else 'behavioral' if i == 5 else 'role_specific'
        return [dict(q, question_id=f'q{i + 1}', source=source, mode=mode,
                     question_type=(q.get('question_type', mode) if mode == 'mixed' else mode), is_follow_up=False, parent_question_id=None)
                for i, q in enumerate(questions)]

    def feedback(self, context, question, answer, history):
        result = self._call('evaluate', Evaluation, context, question, answer, history)
        # Evidence must be a literal excerpt of the candidate's answer.
        if result and (not result['evidence'] or any(not e.strip() or e not in answer for e in result['evidence'])):
            result = None
        if result:
            return dict(result, benchmark=_benchmark(result['score']), source='ai')
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
        generated = self._call('debrief', Debrief, context, responses)
        result.update(generated or {})
        result.update(source='ai' if generated else 'fallback',
                      resume_evidence=[e['title'] for e in context['resume']['project_entries'] + context['resume']['experience_entries']
                                       if e['title'] and any(e['title'].casefold() in r.get('answer', '').casefold() for r in responses)][:5],
                      strongest_questions=[r['question_prompt'][:500] for r in sorted(responses, key=lambda r: r['score'], reverse=True)[:2]],
                      practice_questions=[r['question_prompt'][:500] for r in sorted(responses, key=lambda r: r['score'])[:2]])
        def response_reference(r):
            return {'question': r['question_prompt'][:500], 'answer_excerpt': r.get('answer', '')[:500], 'score': r['score']}
        ordered = sorted(responses, key=lambda r: r['score'])
        result.update(strongest_responses=[response_reference(r) for r in ordered[-2:][::-1]],
                      weakest_responses=[response_reference(r) for r in ordered[:2]],
                      specificity_needs=list(dict.fromkeys(
                          improvement for r in responses for improvement in r.get('feedback', {}).get('improvements', [])))[:5])
        if not generated:
            result.update(technical_signals='Review technical correctness separately; these scores measure answer signals.',
                          communication_signals=result['overall_summary'])
        # Keep cached final answer + debrief within existing MySQL TEXT storage.
        # These are display excerpts; full answers remain in their response records.
        for key in ('strongest_responses', 'weakest_responses'):
            for item in result[key]:
                item['answer_excerpt'] = item['answer_excerpt'][:200]
                item['question'] = item['question'][:200]
        for key in ('resume_evidence', 'strongest_questions', 'practice_questions', 'specificity_needs'):
            result[key] = [item[:200] for item in result[key]]
        return result
