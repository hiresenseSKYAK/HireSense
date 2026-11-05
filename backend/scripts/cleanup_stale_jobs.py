"""Daily age cleanup: hide jobs older than the 30-day limit.

A job's age is its posting date, or the day the crawler first found it when the
source gives no posting date. Old jobs are marked status = 'expired' and
active = FALSE (reversible; rows are not deleted, so interview history that
points at a job keeps working). The limit can be changed with JOB_MAX_AGE_DAYS.

Usage:
    python -m scripts.cleanup_stale_jobs          # count only (dry run)
    python -m scripts.cleanup_stale_jobs --apply  # hide them
"""

from __future__ import annotations

from database.queries import JOB_MAX_AGE_DAYS, expire_old_jobs


def cleanup_stale(*, dry_run: bool = True) -> int:
    return expire_old_jobs(dry_run=dry_run)


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    label = "expired" if args.apply else "would expire"
    print(f"[expire] max_age_days={JOB_MAX_AGE_DAYS} {label}={cleanup_stale(dry_run=not args.apply)}")
