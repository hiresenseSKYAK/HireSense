"""Provider-neutral interview orchestration. No credentials or vendor SDKs here."""
import json
import logging
from typing import Annotated, Literal, Protocol

from pydantic import BaseModel, ConfigDict, Field, model_validator

from services.interview_service import (
    _benchmark, _build_focus_skills, _description_text, _speakable_label,
    _top_resume_project, build_final_result, evaluate_answer, generate_interview_questions,
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
    evidence: list[BriefText] = Field(default_factory=list, max_length=5)
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
    def generate(self, context: dict) -> dict: ...
    def evaluate(self, context: dict, question: dict, answer: str, history: list[dict]) -> dict: ...
    def debrief(self, context: dict, responses: list[dict]) -> dict: ...


def interview_context(job: dict, resume: dict, mode: str, count: int) -> dict:
    """Allowlist professional context; exclude contact details and server metadata."""
    focus = _build_focus_skills(job, resume)
    focus = {key: [str(v)[:100] for v in value[:50]] if isinstance(value, list) else str(value)[:100]
             for key, value in focus.items()}
    return {
        'job': {key: str(job.get(key) or '')[:12000] for key in (
            'job_title', 'company', 'location', 'job_type', 'experience_level', 'work_style')},
        'description': _description_text(job)[:12000],
        'skills': focus,
        'resume': {
            'skills': [str(s)[:100] for s in resume.get('skills', [])[:50]],
            **{key: [{'title': str(e.get('title', ''))[:200],
                      'bullets': [str(b)[:1000] for b in e.get('bullets', [])[:8]]}
                     for e in resume.get(key, [])[:10]]
               for key in ('experience_entries', 'project_entries', 'leadership_entries')},
            'education': [str(e)[:500] for e in resume.get('education', [])[:10]],
            **{key: [str(e)[:1000] for e in resume.get(key, [])[:10]]
               for key in ('experience', 'projects', 'leadership')},
        },
        'mode': mode, 'question_count': count,
    }


class InterviewEngine:
    def __init__(self, provider: InterviewProvider | None = None):
        self.provider = provider

    def _call(self, method, schema, *args):
        if self.provider is None:
            return None
        try:
            result = schema.model_validate(getattr(self.provider, method)(*args)).model_dump()
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
            if len({q['prompt'].casefold() for q in questions}) != count:
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
                    q.update(prompt=prompt, focus_area='Behavioral', target_keywords=[project])
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
                    q.update(prompt=f'Using {focus}, {technical_prompts[i]}', focus_area=f'Technical Depth: {focus}', target_keywords=[focus])
            elif mode == 'role_specific':
                for q in questions:
                    q['prompt'] += f" Connect your answer to the {context['job']['job_title']} responsibilities."
            questions = questions[:count]
        return [dict(q, question_id=f'q{i + 1}', source=source, mode=mode,
                     question_type=mode if source == 'fallback' else q['question_type'], is_follow_up=False)
                for i, q in enumerate(questions)]

    def feedback(self, context, question, answer, history):
        result = self._call('evaluate', Evaluation, context, question, answer, history)
        # Evidence must be a literal excerpt of the candidate's answer.
        if result and any(not e.strip() or e not in answer for e in result['evidence']):
            result = None
        if result:
            return dict(result, benchmark=_benchmark(result['score']), source='ai')
        result = evaluate_answer(question, answer)
        weakest = min(result['dimensions'], key=lambda d: d['score'])['label']
        followups = {
            'Relevance': 'How does that example connect to the skill or responsibility in the question?',
            'Structure': 'What was the problem, what did you personally do, and what happened afterward?',
            'Specificity': 'Can you describe one concrete decision you made and why you chose that approach?',
            'Impact': 'What changed because of your work, and how did you observe or measure that outcome?',
        }
        return dict(result, source='fallback', evidence=[],
                    technical_depth='Heuristic feedback cannot verify technical correctness.',
                    communication=result['summary'], role_relevance=result['improvements'][0] if result['improvements'] else 'You connected your example to the question.',
                    suggested_approach='Use a specific situation, your actions and reasoning, and an observed result.',
                    follow_up=followups[weakest] if result['score'] < 70 else None)

    def final(self, context, responses):
        result = build_final_result(responses)
        generated = self._call('debrief', Debrief, context, responses)
        result.update(generated or {})
        result.update(source='ai' if generated else 'fallback',
                      resume_evidence=[e['title'] for e in context['resume']['project_entries'] + context['resume']['experience_entries'] if e['title']][:5],
                      strongest_questions=[r['question_prompt'][:500] for r in sorted(responses, key=lambda r: r['score'], reverse=True)[:2]],
                      practice_questions=[r['question_prompt'][:500] for r in sorted(responses, key=lambda r: r['score'])[:2]])
        if not generated:
            result.update(technical_signals='Review technical correctness separately; these scores measure answer signals.',
                          communication_signals=result['overall_summary'])
        return result
