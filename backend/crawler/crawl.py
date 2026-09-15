import time

try:
    from ai.job_description import backfill_missing_summaries, simplify_jobs
    from ai.skill_extraction import backfill_job_skills, extract_skills_for_jobs
    from crawler.parsers.linkedin import parse_job_linkedin
    from crawler.parsers.handshake import parse_job_handshake
    from database.queries import insert_job
    from services.updater import update_database
except ImportError:
    import os
    import sys

    sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
    from ai.job_description import backfill_missing_summaries, simplify_jobs
    from ai.skill_extraction import backfill_job_skills, extract_skills_for_jobs
    from crawler.parsers.linkedin import parse_job_linkedin
    from crawler.parsers.handshake import parse_job_handshake
    from database.queries import insert_job
    from services.updater import update_database

# Stop each search URL after this many seconds (paging + job details).
PER_URL_TIME_LIMIT_SEC = 10 * 60

def _log_db_target():
    from database.connection import get_connection

    conn = get_connection()
    try:
        print(
            f"[db] target: host={conn.server_host} port={conn.server_port} "
            f"database={conn.database}",
            flush=True,
        )
    finally:
        conn.close()

def run():
    print("[crawl] run() started", flush=True)
    _log_db_target()

    print("[crawl] removing expired postings", flush=True)
    try:
        update_database()
    except Exception as exc:
        print(f"[crawl] expired-posting cleanup failed: {exc}", flush=True)

    jobs = []

    location = "Dallas-Fort%20Worth%20Metroplex"
    # LinkedIn: f_E=1 Internship, f_E=2 Entry level
    experience_filter = "f_E=1%2C2"
    keywords = [
        # fields instead of job titles
        "artificial intelligence",
        "computer science",
        "information technology",
        "cybersecurity",
        "data science",
        "software engineering",
    ]
    linkedin_urls = [
        (
            "https://www.linkedin.com/jobs/search/"
            f"?keywords={keyword.replace(' ', '%20')}"
            f"&location={location}&{experience_filter}"
        )
        for keyword in keywords
    ]
    # Handshake public pages use city/role path slugs, not LinkedIn-style query params.
    # Dallas has no public tech find-jobs role pages; internships + remote jobs do.
    handshake_urls = [
        "https://joinhandshake.com/internships/dallas-tx/artificial-intelligence/",
        "https://joinhandshake.com/internships/dallas-tx/computer-science/",
        "https://joinhandshake.com/internships/dallas-tx/data-science/",
        "https://joinhandshake.com/internships/dallas-tx/software-engineering/",
        "https://joinhandshake.com/internships/dallas-tx/information-technology/",
        "https://joinhandshake.com/internships/dallas-tx/cybersecurity/",
        "https://joinhandshake.com/internships/remote/artificial-intelligence/",
        "https://joinhandshake.com/internships/remote/computer-science/",
        "https://joinhandshake.com/internships/remote/data-science/",
        "https://joinhandshake.com/internships/remote/software-engineering/",
        "https://joinhandshake.com/internships/remote/information-technology/",
        "https://joinhandshake.com/internships/remote/cybersecurity/",
    ]
    urls = linkedin_urls + handshake_urls

    for i, url in enumerate(urls, start=1):
        print(
            f"[crawl] fetching URL {i}/{len(urls)} "
            f"(up to {PER_URL_TIME_LIMIT_SEC // 60} min): {url}",
            flush=True,
        )
        started = time.monotonic()
        try:
            if "linkedin.com" in url:
                new_jobs = parse_job_linkedin(url, time_limit_sec=PER_URL_TIME_LIMIT_SEC)
            elif "joinhandshake.com" in url:
                new_jobs = parse_job_handshake(url, time_limit_sec=PER_URL_TIME_LIMIT_SEC)
            else:
                raise ValueError(f"Unknown URL: {url}")
            elapsed = time.monotonic() - started
            print(
                f"[crawl]   -> parsed {len(new_jobs)} job(s) in {elapsed:.0f}s",
                flush=True,
            )
            jobs.extend(new_jobs)
        except Exception as exc:
            print(f"[crawl]   -> parser failed for URL {i}: {exc}", flush=True)

    print(f"[crawl] total jobs collected before insert: {len(jobs)}", flush=True)

    if jobs:
        print("[crawl] simplifying job descriptions", flush=True)
        simplify_jobs(jobs)
        print("[crawl] extracting skills with JobBERT", flush=True)
        extract_skills_for_jobs(jobs)
    else:
        print("[crawl] no new jobs found", flush=True)

    inserted = 0
    failed = 0

    for idx, job in enumerate(jobs, start=1):
        title = (job.get("job_title") or "Unknown Title")[:70]
        try:
            result = insert_job(job)
            if result is False:
                print(f"[crawl] insert {idx}/{len(jobs)} skipped: {title!r}", flush=True)
            else:
                inserted += 1
                print(f"[crawl] insert {idx}/{len(jobs)} OK: {title!r}", flush=True)
        except Exception as exc:
            failed += 1
            print(f"[crawl] insert {idx}/{len(jobs)} FAILED: {title!r} - {exc}", flush=True)
            continue

    print("[crawl] backfilling any remaining null summaries", flush=True)
    backfill_missing_summaries()
    print("[crawl] backfilling any empty skill lists", flush=True)
    backfill_job_skills(only_empty=True)

    print(
        f"[crawl] done: processed={len(jobs)} inserted_or_skipped={inserted} failed={failed}",
        flush=True,
    )

if __name__ == "__main__":
    run()