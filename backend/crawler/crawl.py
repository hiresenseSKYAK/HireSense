"""Crawl supported public job sources into HireSense."""

from __future__ import annotations

import argparse
import time

try:
    from ai.job_description import backfill_missing_summaries, simplify_jobs
    from ai.skill_extraction import backfill_job_skills, extract_skills_for_jobs
    from crawler.parsers.handshake import parse_job_handshake
    from crawler.parsers.linkedin import parse_job_linkedin
    from crawler.sources import DEFAULT_SOURCE_LIMITS, PER_SEARCH_ACCEPT_LIMIT, source_urls
    from database.job_identity import build_job_identity
    from database.queries import upsert_job
    from services.updater import update_database
except ImportError:
    import os
    import sys

    sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
    from ai.job_description import backfill_missing_summaries, simplify_jobs
    from ai.skill_extraction import backfill_job_skills, extract_skills_for_jobs
    from crawler.parsers.handshake import parse_job_handshake
    from crawler.parsers.linkedin import parse_job_linkedin
    from crawler.sources import DEFAULT_SOURCE_LIMITS, PER_SEARCH_ACCEPT_LIMIT, source_urls
    from database.job_identity import build_job_identity
    from database.queries import upsert_job
    from services.updater import update_database


PER_URL_TIME_LIMIT_SEC = 10 * 60


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


def collect_jobs(*, source: str, limit: int) -> tuple[list[dict], dict[str, int]]:
    """Collect bounded candidates across searches and deduplicate before DB work."""
    jobs: list[dict] = []
    seen: set[str] = set()
    totals = {"discovered": 0, "accepted": 0, "rejected": 0, "duplicates": 0, "source_errors": 0}
    urls = source_urls(source)

    for index, (source_name, url) in enumerate(urls, start=1):
        if len(jobs) >= limit:
            break
        per_search_limit = min(PER_SEARCH_ACCEPT_LIMIT, limit - len(jobs))
        print(
            f"[crawl] fetching {source_name} search {index}/{len(urls)} "
            f"(accept up to {per_search_limit}): {url}",
            flush=True,
        )
        parser_stats: dict[str, int] = {}
        started = time.monotonic()
        try:
            parser = parse_job_linkedin if source_name == "linkedin" else parse_job_handshake
            found = parser(
                url, max_jobs=per_search_limit,
                time_limit_sec=PER_URL_TIME_LIMIT_SEC, stats=parser_stats,
            )
        except Exception as exc:
            totals["source_errors"] += 1
            print(f"[crawl] {source_name} search failed: {exc}", flush=True)
            continue

        totals["discovered"] += parser_stats.get("discovered", len(found))
        totals["accepted"] += len(found)
        totals["rejected"] += parser_stats.get("skipped", 0)
        totals["source_errors"] += parser_stats.get("errors", 0)
        added = 0
        for job in found:
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
            f"[crawl] search result discovered={parser_stats.get('discovered', len(found))} "
            f"accepted={len(found)} unique_added={added} rejected={parser_stats.get('skipped', 0)} "
            f"errors={parser_stats.get('errors', 0)} duration_seconds={time.monotonic() - started:.1f}",
            flush=True,
        )
    return jobs, totals


def run(*, dry_run=False, source="all", limit=None, skip_cleanup=False):
    run_started = time.monotonic()
    effective_limit = limit or DEFAULT_SOURCE_LIMITS[source]
    print(
        f"[crawl] started dry_run={dry_run} source={source} limit={effective_limit} "
        f"skip_cleanup={skip_cleanup or dry_run}",
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

    jobs, totals = collect_jobs(source=source, limit=effective_limit)
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
        "would_insert", "would_update",
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
        print(
            f"[crawl] job {index}/{len(jobs)} {result.action}: "
            f"{(job.get('job_title') or 'Unknown Title')[:70]!r} identity={result.reason}",
            flush=True,
        )

    if not dry_run:
        backfill_missing_summaries()
        backfill_job_skills(only_empty=True)

    print(
        f"[crawl] summary source={source} discovered={totals['discovered']} "
        f"accepted={totals['accepted']} rejected={totals['rejected']} "
        f"inserted={counts['inserted']} updated={counts['updated']} "
        f"idempotent={counts['unchanged']} invalid={counts['skipped']} "
        f"duplicates={totals['duplicates']} conflicts={counts['conflict']} "
        f"database_errors={counts['error']} deactivated={cleanup_result.get('deactivated', 0)} "
        f"source_errors={totals['source_errors']} duration_seconds={time.monotonic() - run_started:.1f}",
        flush=True,
    )
    return {**totals, **counts, "unique_candidates": len(jobs)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Crawl and compare without writes.")
    parser.add_argument("--source", choices=("all", "linkedin", "handshake"), default="all")
    parser.add_argument("--limit", type=int, help="Total unique candidate ceiling.")
    parser.add_argument("--skip-cleanup", action="store_true", help="Skip lifecycle link checks.")
    args = parser.parse_args()
    if args.limit is not None and args.limit < 1:
        parser.error("--limit must be at least 1")
    result = run(
        dry_run=args.dry_run, source=args.source,
        limit=args.limit, skip_cleanup=args.skip_cleanup,
    )
    if result["error"] or result["conflict"]:
        raise SystemExit(1)
    if result["source_errors"] and not result["unique_candidates"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
