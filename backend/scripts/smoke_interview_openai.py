"""Developer-only one-call OpenAI structured-output smoke test.

Run manually from backend/: python -m scripts.smoke_interview_openai
Uses synthetic data only and never prints credentials or model output.
"""
from services.interview_engine import InterviewEngine, interview_context
from services.interview_provider import build_openai_interview_provider
from services.interview_settings import get_interview_ai_settings


def synthetic_acceptance_batch() -> dict[str, int]:
    """Provider-free regression signal; these counts are not a production rate."""
    answer = 'I built a Python API and tested failure cases.'
    valid = {
        'score': 60, 'summary': 'A concrete implementation example.',
        'strengths': ['Named the implementation.'], 'improvements': ['Explain the test results.'],
        'dimensions': [{'label': label, 'score': 15} for label in ('Relevance', 'Structure', 'Specificity', 'Impact')],
        'evidence': ['built a Python API'], 'follow_up': None,
    }
    class FixtureProvider:
        provider_name = 'synthetic'
        model = 'fixture'

        def __init__(self, initial, repaired=None):
            self.initial, self.repaired = initial, repaired
            self.repairs = 0

        def evaluate(self, *_args):
            return self.initial

        def repair_evaluation(self, *_args):
            self.repairs += 1
            return self.repaired

    context = interview_context({'job_title': 'Backend Intern', 'skills': ['Python']}, {'skills': ['Python']}, 'technical', 3)
    cases = [FixtureProvider(valid), FixtureProvider({key: value for key, value in valid.items() if key != 'summary'}, valid),
             FixtureProvider(dict(valid, evidence=['invented work']))]
    counts = {'ai_accepted': 0, 'ai_repaired': 0, 'fallback': 0}
    for provider in cases:
        result = InterviewEngine(provider).feedback(context, {'question_type': 'technical'}, answer, [])
        bucket = 'fallback' if result['source'] == 'fallback' else 'ai_repaired' if provider.repairs else 'ai_accepted'
        counts[bucket] += 1
    return counts


def main() -> int:
    counts = synthetic_acceptance_batch()
    print(f"Synthetic evaluation batch: accepted={counts['ai_accepted']} repaired={counts['ai_repaired']} fallback={counts['fallback']}.")
    settings = get_interview_ai_settings()
    if not settings.enabled:
        print("OPENAI_API_KEY is not configured; smoke test was not run.")
        return 2
    provider = build_openai_interview_provider(settings)
    if provider is None:
        print("OpenAI provider could not be initialized.")
        return 1
    engine = InterviewEngine(provider)
    job = {
        "job_title": "Software Engineering Intern",
        "company": "Example Company",
        "location": "Dallas, TX",
        "job_type": "Internship",
        "experience_level": "Internship",
        "work_style": "Hybrid",
        "skills": ["Python", "SQL"],
        "job_description": "Build and test small Python APIs backed by SQL.",
    }
    resume = {"skills": ["Python"], "project_entries": [{"title": "Course API", "bullets": ["Built tested API endpoints."]}]}
    questions = engine.questions(
        job, resume,
        "mixed",
        3,
    )
    if not questions or questions[0]["source"] != "ai":
        print("OpenAI request did not produce a validated structured question set; fallback was used.")
        return 1
    answer = "I built a Python API, chose SQL for structured data, and tested failure cases before delivery."
    feedback = engine.feedback(interview_context(job, resume, "mixed", 3), questions[0], answer, [])
    if feedback.get("source") != "ai":
        print("OpenAI evaluation reached the provider but failed validated acceptance; fallback was used.")
        return 1
    print(f"OpenAI question and evaluation acceptance smoke test succeeded with model {settings.model!r}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
