"""Preview or apply additive identity values for existing job_data rows."""

from __future__ import annotations

import argparse
from collections import defaultdict

from database.connection import get_connection
from database.job_identity import build_job_identity


def backfill(*, apply=False) -> int:
    connection = get_connection()
    cursor = connection.cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT id, source, source_job_id, job_title, company, location,
                   date_posted, application_link, canonical_url, identity_key
            FROM job_data
            ORDER BY id
            """
        )
        rows = cursor.fetchall()
        prepared = []
        collisions = defaultdict(list)
        skipped = []
        for row in rows:
            identity = build_job_identity(row)
            if identity is None:
                skipped.append(row["id"])
                continue
            collisions[identity.identity_key].append(row["id"])
            prepared.append((row, identity))

        duplicate_groups = {
            key: ids for key, ids in collisions.items() if len(ids) > 1
        }
        print(
            f"[identity] rows={len(rows)} prepared={len(prepared)} "
            f"skipped={len(skipped)} collisions={len(duplicate_groups)}",
            flush=True,
        )
        if skipped:
            print(f"[identity] rows without safe identity: {skipped}", flush=True)
        for key, ids in duplicate_groups.items():
            print(f"[identity] collision {key}: rows={ids}", flush=True)
        if duplicate_groups:
            connection.rollback()
            print("[identity] no changes applied; review collisions first", flush=True)
            return 2
        if not apply:
            connection.rollback()
            print("[identity] dry-run only; use --apply after review", flush=True)
            return 0

        updated = 0
        for row, identity in prepared:
            values = (
                identity.source,
                identity.source_job_id,
                identity.canonical_url,
                identity.identity_key,
                row["id"],
            )
            cursor.execute(
                """
                UPDATE job_data
                SET source = %s,
                    source_job_id = %s,
                    canonical_url = %s,
                    identity_key = %s
                WHERE id = %s
                """,
                values,
            )
            updated += cursor.rowcount
        connection.commit()
        print(f"[identity] applied identity values to {updated} row(s)", flush=True)
        return 0
    except Exception:
        connection.rollback()
        raise
    finally:
        cursor.close()
        connection.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Write identity columns. Without this flag the command is read-only.",
    )
    args = parser.parse_args()
    return backfill(apply=args.apply)


if __name__ == "__main__":
    raise SystemExit(main())
