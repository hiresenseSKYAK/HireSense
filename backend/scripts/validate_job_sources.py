"""Run live source discovery without importing database connection code."""

from __future__ import annotations

import argparse
import time

from crawler.parsers.handshake import parse_job_handshake
from crawler.parsers.linkedin import parse_job_linkedin
from crawler.sources import DEFAULT_SOURCE_LIMITS, PER_SEARCH_ACCEPT_LIMIT, source_urls
from database.job_identity import build_job_identity


def validate(source: str, limit: int) -> dict:
    started = time.monotonic()
    unique_jobs: list[dict] = []
    seen: set[str] = set()
    result = {"discovered": 0, "accepted": 0, "rejected": 0, "duplicates": 0, "source_errors": 0}
    urls = source_urls(source)
    for index, (source_name, url) in enumerate(urls, start=1):
        if len(unique_jobs) >= limit:
            break
        stats: dict[str, int] = {}
        per_search = min(PER_SEARCH_ACCEPT_LIMIT, limit - len(unique_jobs))
        print(f"[validate] {source_name} search {index}/{len(urls)} limit={per_search}: {url}", flush=True)
        try:
            parser = parse_job_linkedin if source_name == "linkedin" else parse_job_handshake
            jobs = parser(url, max_jobs=per_search, time_limit_sec=600, stats=stats)
        except Exception as exc:
            result["source_errors"] += 1
            print(f"[validate] source failure: {exc}", flush=True)
            continue
        result["discovered"] += stats.get("discovered", len(jobs))
        result["accepted"] += len(jobs)
        result["rejected"] += stats.get("skipped", 0)
        result["source_errors"] += stats.get("errors", 0)
        for job in jobs:
            identity = build_job_identity(job)
            keys = set()
            if identity:
                keys.add(identity.identity_key)
                if identity.canonical_url:
                    keys.add(f"url:{identity.canonical_url}")
            if keys & seen:
                result["duplicates"] += 1
                continue
            seen.update(keys)
            unique_jobs.append(job)
            if len(unique_jobs) >= limit:
                break

    result["unique"] = len(unique_jobs)
    result["duration_seconds"] = round(time.monotonic() - started, 1)
    print("[validate] accepted sample:", flush=True)
    for job in unique_jobs[:10]:
        print(f"  - {job.get('job_title')} — {job.get('company')}", flush=True)
    print(
        "[validate] summary " + " ".join(f"{key}={value}" for key, value in result.items()),
        flush=True,
    )
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", choices=("all", "linkedin", "handshake"), default="all")
    parser.add_argument("--limit", type=int)
    args = parser.parse_args()
    limit = args.limit or DEFAULT_SOURCE_LIMITS[args.source]
    if limit < 1:
        parser.error("--limit must be at least 1")
    validate(args.source, limit)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
