"""Guarded migration, dry-run, controlled crawl, and count verification."""

from __future__ import annotations

import os
import subprocess
import sys

from database.connection import DB_HOST, DB_NAME, DB_PORT, DB_USER, get_connection
from database.migrate import migrate


EXPECTED_HOST = "hiresense-mysql-hiresense-capstone.e.aivencloud.com"
EXPECTED_PORT = "10188"
EXPECTED_DATABASE = "defaultdb"


def _confirm(prompt: str) -> bool:
    return input(f"{prompt} Type YES to continue: ").strip() == "YES"


def _report_database(label: str) -> None:
    connection = get_connection()
    cursor = connection.cursor()
    try:
        cursor.execute("SELECT COUNT(*) FROM job_data")
        total = int(cursor.fetchone()[0])
        cursor.execute(
            "SELECT COALESCE(source, 'unknown'), COUNT(*) FROM job_data "
            "WHERE active = TRUE GROUP BY source ORDER BY source"
        )
        sources = ", ".join(f"{source}={count}" for source, count in cursor.fetchall()) or "none"
        cursor.execute(
            "SELECT COUNT(*) FROM (SELECT source, source_job_id FROM job_data "
            "WHERE source IS NOT NULL AND source_job_id IS NOT NULL "
            "GROUP BY source, source_job_id HAVING COUNT(*) > 1) duplicates"
        )
        source_duplicates = int(cursor.fetchone()[0])
        cursor.execute(
            "SELECT COUNT(*) FROM (SELECT canonical_url FROM job_data "
            "WHERE canonical_url IS NOT NULL GROUP BY canonical_url HAVING COUNT(*) > 1) duplicates"
        )
        url_duplicates = int(cursor.fetchone()[0])
    finally:
        cursor.close()
        connection.close()
    print(
        f"[rollout] {label}: total={total} active_sources=({sources}) "
        f"duplicate_source_ids={source_duplicates} duplicate_urls={url_duplicates}",
        flush=True,
    )


def _verify_schema() -> None:
    required_columns = {
        "source", "source_job_id", "canonical_url", "identity_key",
        "first_seen_at", "last_seen_at", "last_checked_at", "active",
    }
    required_indexes = {"uq_job_data_identity_key", "uq_job_data_source_job"}
    connection = get_connection()
    cursor = connection.cursor()
    try:
        cursor.execute(
            "SELECT COLUMN_NAME FROM information_schema.COLUMNS "
            "WHERE TABLE_SCHEMA = %s AND TABLE_NAME = 'job_data'",
            (DB_NAME,),
        )
        columns = {row[0] for row in cursor.fetchall()}
        cursor.execute(
            "SELECT DISTINCT INDEX_NAME FROM information_schema.STATISTICS "
            "WHERE TABLE_SCHEMA = %s AND TABLE_NAME = 'job_data'",
            (DB_NAME,),
        )
        indexes = {row[0] for row in cursor.fetchall()}
    finally:
        cursor.close()
        connection.close()
    missing = sorted((required_columns - columns) | (required_indexes - indexes))
    if missing:
        raise RuntimeError(f"Migration verification failed; missing: {', '.join(missing)}")
    print("[rollout] required columns and indexes verified", flush=True)


def _crawl(*, source: str, limit: int, dry_run: bool) -> None:
    command = [
        sys.executable, "-m", "crawler.crawl", "--source", source,
        "--limit", str(limit), "--skip-cleanup",
    ]
    if dry_run:
        command.append("--dry-run")
    environment = os.environ.copy()
    environment["SUMMARIZE_JOB_DESCRIPTIONS"] = "false"
    environment["EXTRACT_JOB_SKILLS"] = "false"
    subprocess.run(command, check=True, env=environment)


def main() -> int:
    if (DB_HOST, str(DB_PORT), DB_NAME) != (EXPECTED_HOST, EXPECTED_PORT, EXPECTED_DATABASE):
        raise RuntimeError("Refusing rollout: DB host, port, or database is not canonical production")
    print(f"[rollout] target host={DB_HOST} port={DB_PORT} database={DB_NAME} user={DB_USER}")
    _report_database("before")
    if not _confirm("Apply additive tracked migrations?"):
        print("[rollout] stopped before migration")
        return 0
    migrate()
    _verify_schema()
    print("[rollout] starting full non-writing source validation")
    _crawl(source="linkedin", limit=150, dry_run=True)
    _crawl(source="handshake", limit=100, dry_run=True)
    if not _confirm("Both dry-runs looked valid. Upsert the bounded production crawl?"):
        print("[rollout] stopped before all crawler writes")
        return 0
    _crawl(source="linkedin", limit=150, dry_run=False)
    _report_database("after LinkedIn")
    _crawl(source="handshake", limit=100, dry_run=False)
    _report_database("after all sources")
    print("[rollout] verify the live /jobs/ and /jobs/market-insights endpoints next")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
