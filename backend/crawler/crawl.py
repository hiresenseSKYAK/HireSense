"""Crawl supported public job sources into HireSense."""

from __future__ import annotations

import argparse
import os
import time

try:
    from ai.job_description import backfill_missing_summaries, simplify_jobs
    from ai.skill_extraction import backfill_job_skills, extract_skills_for_jobs
    from crawler import providers
    from crawler.health import record_sync, source_key, is_rate_limited
    from crawler.sources import (
        DEFAULT_SOURCE_LIMITS, DEFAULT_SOURCE_TIME_LIMITS_SEC,
        PER_SEARCH_ACCEPT_LIMIT, PER_SEARCH_TIME_LIMIT_SEC, source_specs,
    )
    from database.job_identity import build_job_identity
    from database.queries import upsert_job
    from services.updater import update_database
except ImportError:
    import os
    import sys

    sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
    from ai.job_description import backfill_missing_summaries, simplify_jobs
    from ai.skill_extraction import backfill_job_skills, extract_skills_for_jobs
    from crawler import providers
    from crawler.health import record_sync, source_key, is_rate_limited
    from crawler.sources import (
        DEFAULT_SOURCE_LIMITS, DEFAULT_SOURCE_TIME_LIMITS_SEC,
        PER_SEARCH_ACCEPT_LIMIT, PER_SEARCH_TIME_LIMIT_SEC, source_specs,
    )
    from database.job_identity import build_job_identity
    from database.queries import upsert_job
    from services.updater import update_database


def _log_db_target():
    from database.connection import get_connection

    conn = get_connection()
    try:
        print(
            f"[db] target: host={conn.server_host} port={conn.server_port} database={conn.database}",
            flush=True,
        )
    finally:
        conn.close()


def collect_jobs(
    *, source: str, limit: int, time_limit_sec: int | None = None, persist_health: bool = False
) -> tuple[list[dict], dict[str, int]]:
    """Collect bounded candidates across searches and deduplicate before DB work."""
    jobs: list[dict] = []
    seen: set[str] = set()
    totals = {"discovered": 0, "accepted": 0, "rejected": 0, "duplicates": 0, "source_errors": 0}
    specs = source_specs(source)
    source_time_limit = time_limit_sec or DEFAULT_SOURCE_TIME_LIMITS_SEC[source]
    deadline = time.monotonic() + source_time_limit

    for index, spec in enumerate(specs, start=1):
        source_name, url = spec.provider, spec.url
        if len(jobs) >= limit:
            break
        if persist_health and source_name in {"adzuna", "usajobs", "greenhouse", "lever", "ashby"}:
            try:
                if is_rate_limited(spec):
                    print(f"[crawl] {source_name} cooling down after rate limit", flush=True)
                    continue
            except Exception:
                pass  # Telemetry cannot take down ingestion.
        remaining_seconds = deadline - time.monotonic()
        if remaining_seconds <= 0:
            print(
                f"[crawl] {source} source budget exhausted after {source_time_limit}s; "
                "remaining searches skipped",
                flush=True,
            )
            break
        per_search_limit = min(PER_SEARCH_ACCEPT_LIMIT, limit - len(jobs))
        per_search_time_limit = max(
            1, min(PER_SEARCH_TIME_LIMIT_SEC, int(remaining_seconds))
        )
        print(f"[crawl] fetching {source_name} source {index}/{len(specs)} "
              f"(accept up to {per_search_limit})", flush=True)
        started = time.monotonic()
        try:
            result = providers.fetch(spec, max_jobs=per_search_limit,
                                     time_limit_sec=per_search_time_limit)
        except Exception as exc:
            totals["source_errors"] += 1
            code = getattr(exc, "code", type(exc).__name__)
            print(f"[crawl] {source_name} source failed code={code}", flush=True)
            if persist_health:
                try:
                    record_sync(spec, success=False, jobs_received=0,
                                duration_ms=int((time.monotonic() - started) * 1000),
                                error_code=code, rate_limited=getattr(exc, "rate_limited", False))
                except Exception:
                    totals["source_errors"] += 1
            continue

        found = result.jobs
        if persist_health and result.error_code != "credentials_missing":
            try:
                record_sync(spec, success=not result.errors, jobs_received=len(found),
                            duration_ms=int((time.monotonic() - started) * 1000),
                            error_code=result.error_code or ("fetch_error" if result.errors else None),
                            rate_limited=result.rate_limited,
                            complete_snapshot=(source_name in {"greenhouse", "lever", "ashby"}
                                               and result.discovered < per_search_limit and not result.errors))
            except Exception:
                totals["source_errors"] += 1

        totals["discovered"] += result.discovered
        totals["accepted"] += len(found)
        totals["rejected"] += result.skipped
        totals["source_errors"] += result.errors
        added = 0
        for job in found:
            job["source_feed_key"] = source_key(spec)
            identity = build_job_identity(job)
            keys = set()
            if identity:
                keys.add(identity.identity_key)
                if identity.canonical_url:
                    keys.add(f"url:{identity.canonical_url}")
            if keys & seen:
                totals["duplicates"] += 1
                continue
            seen.update(keys)
            jobs.append(job)
            added += 1
            if len(jobs) >= limit:
                break
        print(
            f"[crawl] source result discovered={result.discovered} "
            f"accepted={len(found)} unique_added={added} rejected={result.skipped} "
            f"errors={result.errors} duration_seconds={time.monotonic() - started:.1f}",
            flush=True,
        )
    return jobs, totals


def run(*, dry_run=False, source="all", limit=None, skip_cleanup=False):
    run_started = time.monotonic()
    effective_limit = limit or DEFAULT_SOURCE_LIMITS[source]
    effective_time_limit = DEFAULT_SOURCE_TIME_LIMITS_SEC[source]
    print(
        f"[crawl] started dry_run={dry_run} source={source} limit={effective_limit} "
        f"time_limit_seconds={effective_time_limit} skip_cleanup={skip_cleanup or dry_run}",
        flush=True,
    )
    _log_db_target()
    cleanup_result = {"deactivated": 0}
    cleanup_errors = 0
    if skip_cleanup or dry_run:
        print("[crawl] lifecycle link checks skipped", flush=True)
    else:
        try:
            cleanup_result = update_database()
        except Exception as exc:
            cleanup_errors = 1
            print(f"[crawl] lifecycle checks failed; ingestion continues: {exc}", flush=True)

    jobs, totals = collect_jobs(
        source=source, limit=effective_limit, time_limit_sec=effective_time_limit,
        persist_health=not dry_run,
    )
    totals["source_errors"] += cleanup_errors
    print(f"[crawl] unique candidates before database work: {len(jobs)}", flush=True)
    if jobs:
        try:
            simplify_jobs(jobs)
        except Exception as exc:
            print(f"[crawl] optional summarization failed; continuing: {exc}", flush=True)
        try:
            extract_skills_for_jobs(jobs)
        except Exception as exc:
            print(f"[crawl] optional skill extraction failed; continuing: {exc}", flush=True)
        for sample in jobs[:3]:
            print(
                f"[crawl] sample source={sample.get('source')} company={sample.get('company')!r} "
                f"title={sample.get('job_title')!r} url={sample.get('application_link')}",
                flush=True,
            )

    counts = {key: 0 for key in (
        "inserted", "updated", "unchanged", "skipped", "conflict", "error",
        "would_insert", "would_update", "duplicates_merged",
    )}
    for index, job in enumerate(jobs, start=1):
        try:
            result = upsert_job(job, dry_run=dry_run)
        except Exception as exc:
            counts["error"] += 1
            print(
                f"[crawl] job {index}/{len(jobs)} failed: "
                f"{(job.get('job_title') or 'Unknown Title')[:70]!r} error={exc}",
                flush=True,
            )
            continue
        counts[result.action] = counts.get(result.action, 0) + 1
        if result.reason == "lower-confidence duplicate":
            counts["duplicates_merged"] += 1
        print(
            f"[crawl] job {index}/{len(jobs)} {result.action}: "
            f"{(job.get('job_title') or 'Unknown Title')[:70]!r} identity={result.reason}",
            flush=True,
        )

    if not dry_run:
        backfill_missing_summaries()
        backfill_job_skills(only_empty=True)

    result = {**totals, **counts, "unique_candidates": len(jobs)}
    result["status"] = crawl_status(result, dry_run=dry_run)
    print(
        f"[crawl] summary source={source} status={result['status']} discovered={totals['discovered']} "
        f"accepted={totals['accepted']} rejected={totals['rejected']} "
        f"inserted={counts['inserted']} updated={counts['updated']} "
        f"idempotent={counts['unchanged']} invalid={counts['skipped']} "
        f"duplicates={totals['duplicates']} duplicates_merged={counts['duplicates_merged']} conflicts={counts['conflict']} "
        f"database_errors={counts['error']} deactivated={cleanup_result.get('deactivated', 0)} "
        f"source_errors={totals['source_errors']} duration_seconds={time.monotonic() - run_started:.1f}",
        flush=True,
    )
    return result


def crawl_status(result, *, dry_run=False):
    persisted = result["unchanged"] + result["inserted"] + result["updated"]
    if dry_run:
        persisted += result["would_insert"] + result["would_update"]
    row_errors = result["error"] + result["conflict"]
    if (result["source_errors"] and not result["unique_candidates"]) or (row_errors and not persisted):
        return "failure"
    if result["source_errors"] or row_errors:
        return "partial_success"
    return "success"


def _write_actions_output(result):
    output_path = os.environ.get("GITHUB_OUTPUT")
    if output_path:
        with open(output_path, "a", encoding="utf-8") as output:
            for key in ("status", "inserted", "updated", "error", "source_errors"):
                output_name = "database_errors" if key == "error" else key
                output.write(f"{output_name}={result[key]}\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Crawl and compare without writes.")
    parser.add_argument("--source", choices=("all", "linkedin", "handshake", "ats", "adzuna", "usajobs"), default="all")
    parser.add_argument("--limit", type=int, help="Total unique candidate ceiling.")
    parser.add_argument("--skip-cleanup", action="store_true", help="Skip lifecycle link checks.")
    args = parser.parse_args()
    if args.limit is not None and args.limit < 1:
        parser.error("--limit must be at least 1")
    result = run(
        dry_run=args.dry_run, source=args.source,
        limit=args.limit, skip_cleanup=args.skip_cleanup,
    )
    _write_actions_output(result)
    if result["status"] == "failure":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
