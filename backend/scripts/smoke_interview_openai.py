"""Developer-only one-call OpenAI structured-output smoke test.

Run manually from backend/: python -m scripts.smoke_interview_openai
Uses synthetic data only and never prints credentials or model output.
"""
from services.interview_engine import InterviewEngine
from services.interview_provider import build_openai_interview_provider
from services.interview_settings import get_interview_ai_settings


def main() -> int:
    settings = get_interview_ai_settings()
    if not settings.enabled:
        print("OPENAI_API_KEY is not configured; smoke test was not run.")
        return 2
    provider = build_openai_interview_provider(settings)
    if provider is None:
        print("OpenAI provider could not be initialized.")
        return 1
    questions = InterviewEngine(provider).questions(
        {
            "job_title": "Software Engineering Intern",
            "company": "Example Company",
            "location": "Dallas, TX",
            "job_type": "Internship",
            "experience_level": "Internship",
            "work_style": "Hybrid",
            "skills": ["Python", "SQL"],
            "job_description": "Build and test small Python APIs backed by SQL.",
        },
        {"skills": ["Python"], "project_entries": [{"title": "Course API", "bullets": ["Built tested API endpoints."]}]},
        "mixed",
        3,
    )
    if not questions or questions[0]["source"] != "ai":
        print("OpenAI request did not produce a validated structured question set; fallback was used.")
        return 1
    print(f"OpenAI structured-output smoke test succeeded with model {settings.model!r}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
