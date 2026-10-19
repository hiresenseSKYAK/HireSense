"""Private operational report; no public API or credential exposure."""

from __future__ import annotations

import json
from datetime import date, datetime, timedelta

from crawler.health import get_health
from crawler.providers import enabled
from database.connection import get_connection
from services.job_experience import assess_job_experience
from services.job_location import assess_job_geography
from services.job_relevance import assess_job_relevance
from services.job_deduplication import partition_unique_postings


def report() -> dict:
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT COUNT(*) FROM job_data WHERE first_seen_at >= CURRENT_DATE")
        added_today = int(cursor.fetchone()[0])
        cursor.execute("SELECT status, COUNT(*) FROM job_data GROUP BY status")
        statuses = dict(cursor.fetchall())
        cursor.execute("SELECT id, source, job_title, company, location, work_style, job_description, application_link, canonical_url FROM job_data WHERE active = TRUE")
        rows = [dict(zip(("id", "source", "job_title", "company", "location", "work_style", "job_description", "application_link", "canonical_url"), row)) for row in cursor.fetchall()]
    finally:
        cursor.close()
        conn.close()
    count = len(rows)
    unique, duplicates = partition_unique_postings(rows)
    quality = {
        "active_jobs": count,
        "early_career_pct": round(100 * sum(assess_job_experience(r["job_title"], r["job_description"]).accepted for r in rows) / count, 1) if count else None,
        "technical_pct": round(100 * sum(assess_job_relevance(r["job_title"], r["job_description"]).relevant for r in rows) / count, 1) if count else None,
        "dfw_or_us_remote_pct": round(100 * sum(assess_job_geography(r["location"], r["work_style"], r["job_description"]).accepted for r in rows) / count, 1) if count else None,
        "visible_duplicate_pct": round(100 * len(duplicates) / count, 1) if count else None,
        "broken_link_pct": None,  # A live verifier sample is required; do not guess.
        "resume_relevance": None,  # User-specific; never reported from global inventory.
    }
    sources = get_health()
    provider_status = {}
    for name in ("greenhouse", "lever", "ashby", "linkedin", "handshake", "adzuna", "usajobs"):
        entries = [row for row in sources if row["provider"] == name]
        max_age = timedelta(hours=2 if name in {"greenhouse", "lever", "ashby"} else 3)
        provider_status[name] = {"configured": enabled(name), "feeds": len(entries),
                                 "healthy_feeds": sum(bool(row["last_success"] and
                                                           datetime.utcnow() - row["last_success"] <= max_age and
                                                           row["failure_count"] == 0) for row in entries)}
    return {"jobs_added_today": added_today, "statuses": statuses,
            "quality": quality, "providers": provider_status, "sources": sources}


if __name__ == "__main__":
    print(json.dumps(report(), default=lambda value: value.isoformat() if isinstance(value, (date, datetime)) else str(value)))
