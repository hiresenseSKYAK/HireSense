"""Daily, reversible stale marking after 45 days of absence from a healthy feed."""

from __future__ import annotations

from database.connection import get_connection


def cleanup_stale(*, dry_run: bool = True) -> int:
    conn = get_connection()
    cursor = conn.cursor()
    predicate = """j.active = TRUE AND j.status = 'active'
       AND j.source_feed_key IS NOT NULL
       AND j.last_seen_at < CURRENT_TIMESTAMP - INTERVAL 45 DAY
       AND (j.last_verified_at IS NULL OR j.last_verified_at < CURRENT_TIMESTAMP - INTERVAL 30 DAY)
       AND h.last_success > j.last_seen_at AND h.failure_count = 0
       AND h.complete_snapshot = TRUE"""
    try:
        if dry_run:
            cursor.execute(f"SELECT COUNT(*) FROM job_data j JOIN job_source_health h ON h.source_key = j.source_feed_key WHERE {predicate}")
            return int(cursor.fetchone()[0])
        cursor.execute(f"UPDATE job_data j JOIN job_source_health h ON h.source_key = j.source_feed_key SET j.status = 'stale', j.active = FALSE WHERE {predicate}")
        count = cursor.rowcount
        conn.commit()
        return count
    except Exception:
        conn.rollback()
        raise
    finally:
        cursor.close()
        conn.close()


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    print(f"[stale] {'marked' if args.apply else 'candidates'}={cleanup_stale(dry_run=not args.apply)}")
