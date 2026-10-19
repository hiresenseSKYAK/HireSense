"""Best-effort, credential-free per-feed telemetry."""

from __future__ import annotations

import hashlib

from crawler.sources import SourceSpec
from database.connection import get_connection


def source_key(spec: SourceSpec) -> str:
    # Search URLs can exceed index limits and must not appear in logs.
    return f"{spec.provider}:{hashlib.sha256(spec.key.encode()).hexdigest()[:24]}"


def record_sync(spec: SourceSpec, *, success: bool, jobs_received: int,
                duration_ms: int, error_code: str | None = None,
                rate_limited: bool = False, complete_snapshot: bool = False) -> None:
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """INSERT INTO job_source_health
               (source_key, provider, company, board_identifier, last_success, last_failure,
                failure_count, jobs_received, complete_snapshot, duration_ms, rate_limited_until, last_error_code)
               VALUES (%s, %s, %s, %s, IF(%s, CURRENT_TIMESTAMP, NULL),
                       IF(%s, NULL, CURRENT_TIMESTAMP), IF(%s, 0, 1), %s, %s, %s,
                       IF(%s, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 60 MINUTE), NULL), %s)
               ON DUPLICATE KEY UPDATE
                 last_success=IF(%s, CURRENT_TIMESTAMP, last_success),
                 last_failure=IF(%s, last_failure, CURRENT_TIMESTAMP),
                 failure_count=IF(%s, 0, failure_count + 1),
                 jobs_received=VALUES(jobs_received), complete_snapshot=VALUES(complete_snapshot), duration_ms=VALUES(duration_ms),
                 rate_limited_until=VALUES(rate_limited_until), last_error_code=VALUES(last_error_code)""",
            (source_key(spec), spec.provider, spec.company, spec.board_identifier, success, success, success,
             jobs_received, complete_snapshot, duration_ms, rate_limited, error_code,
             success, success, success),
        )
        conn.commit()
    finally:
        cursor.close()
        conn.close()


def get_health() -> list[dict]:
    conn = get_connection()
    cursor = conn.cursor(dictionary=True)
    try:
        cursor.execute("SELECT source_key, provider, company, board_identifier, last_success, last_failure, failure_count, jobs_received, complete_snapshot, duration_ms, rate_limited_until, last_error_code FROM job_source_health ORDER BY provider, company")
        return cursor.fetchall()
    finally:
        cursor.close()
        conn.close()


def is_rate_limited(spec: SourceSpec) -> bool:
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT rate_limited_until > CURRENT_TIMESTAMP FROM job_source_health WHERE source_key = %s", (source_key(spec),))
        row = cursor.fetchone()
        return bool(row and row[0])
    finally:
        cursor.close()
        conn.close()
