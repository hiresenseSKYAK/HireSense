"""Write AI summaries for visible jobs that have none, or an outdated one.

The job page otherwise summarizes a job the first time someone opens it, which
makes that first visitor wait a few seconds. This script does the work ahead of
time. Jobs that already have an up-to-date summary are skipped without an API
call, so it is safe to run repeatedly (the crawler workflow runs it after each
crawl). Needs OPENAI_API_KEY and the database settings in the environment.

Usage:
    python -m scripts.backfill_job_summaries --dry-run   # count jobs only
    python -m scripts.backfill_job_summaries             # summarize them
    python -m scripts.backfill_job_summaries --limit 50 --max-runtime 300
"""

from __future__ import annotations

import argparse
import time
from collections import Counter

from sqlalchemy import text

from database.connection import Base, SessionLocal, engine
from database.models import Job, JobAISummary
from database.queries import JOB_AGE_DATE_SQL, JOB_MAX_AGE_DAYS
from services.career_ai import AIRequestBudget
from services.interview_settings import get_interview_ai_settings
from services.job_card import summary_source_hash
from services.job_summary import MIN_DESCRIPTION_CHARS, build_job_summary_service

# The script is not a user; its calls are limited by --limit and --max-runtime instead.
SCRIPT_USER_ID = 0
DELAY_BETWEEN_CALLS_SEC = 0.5


def visible_job_ids_without_summary(db) -> list[int]:
    """Visible jobs (same age and level rules as the job list) needing a summary, newest first.

    That is jobs with no stored summary, and jobs whose description changed after
    their summary was written (the job cards only show a summary that matches the
    current description). Jobs already tried for their current description,
    including ones recorded as having no usable summary, are skipped.
    """
    rows = db.execute(text(f"""
        SELECT j.id, j.job_description, s.source_hash
        FROM job_data j
        LEFT JOIN job_ai_summaries s ON s.job_id = j.id
        WHERE j.active = TRUE
          AND j.experience_level IN ('Internship', 'Entry level')
          AND {JOB_AGE_DATE_SQL} >= CURRENT_DATE - INTERVAL :max_age DAY
          AND CHAR_LENGTH(j.job_description) >= :min_chars
        ORDER BY j.id DESC
    """), {'max_age': JOB_MAX_AGE_DAYS, 'min_chars': MIN_DESCRIPTION_CHARS}).all()
    return [row[0] for row in rows if row[2] is None or row[2] != summary_source_hash(row[1])]


def backfill(*, limit: int | None = None, max_runtime_sec: float = 1500, dry_run: bool = False) -> Counter:
    Base.metadata.create_all(bind=engine, tables=[JobAISummary.__table__])
    settings = get_interview_ai_settings()
    service = build_job_summary_service(settings)
    service.budget = AIRequestBudget(maximum=10**9)
    outcomes: Counter = Counter()

    db = SessionLocal()
    try:
        job_ids = visible_job_ids_without_summary(db)
        if limit is not None:
            job_ids = job_ids[:limit]
        print(f"[summaries] {len(job_ids)} visible job(s) without a current summary", flush=True)
        if dry_run or not job_ids:
            return outcomes
        if service.client is None:
            print("[summaries] OPENAI_API_KEY is not set; nothing summarized", flush=True)
            outcomes['provider_unconfigured'] = len(job_ids)
            return outcomes

        started = time.monotonic()
        for index, job_id in enumerate(job_ids, start=1):
            if time.monotonic() - started >= max_runtime_sec:
                outcomes['left_for_next_run'] = len(job_ids) - index + 1
                print(f"[summaries] time budget reached; {outcomes['left_for_next_run']} left for next run", flush=True)
                break
            job = db.get(Job, job_id)
            if job is None:
                continue
            result = service.summarize(db, SCRIPT_USER_ID, job)
            outcome = 'summarized' if result['source'] == 'ai' else result['reason']
            outcomes[outcome] += 1
            if outcome == 'summarized':
                time.sleep(DELAY_BETWEEN_CALLS_SEC)
            if index % 10 == 0 or index == len(job_ids):
                print(f"[summaries] progress {index}/{len(job_ids)} {dict(outcomes)}", flush=True)
    finally:
        db.close()
    return outcomes


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dry-run", action="store_true", help="Only count the jobs that need a summary.")
    parser.add_argument("--limit", type=int, help="Summarize at most this many jobs.")
    parser.add_argument("--max-runtime", type=float, default=1500, help="Stop after this many seconds.")
    args = parser.parse_args()
    result = backfill(limit=args.limit, max_runtime_sec=args.max_runtime, dry_run=args.dry_run)
    print(f"[summaries] done {dict(result)}", flush=True)
