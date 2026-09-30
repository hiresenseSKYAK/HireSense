"""Audit active jobs and safely deactivate policy violations without deleting rows."""

from __future__ import annotations

import argparse
import json
from urllib.request import urlopen

from services.job_deduplication import partition_unique_postings
from services.job_location import assess_job_geography


def classify_rows(rows: list[dict]) -> dict[str, list[dict]]:
    groups: dict[str, list[dict]] = {"DFW": [], "Remote": [], "Outside": []}
    for row in rows:
        decision = assess_job_geography(
            row.get("location"), row.get("work_style"), row.get("job_description")
        )
        category = decision.category if decision.accepted else "Outside"
        groups[category].append({**row, "reason": decision.reason})
    return groups


def find_exact_duplicates(rows: list[dict]) -> list[dict]:
    """Keep the newest indistinguishable posting and flag older copies."""
    _keepers, duplicates = partition_unique_postings(rows)
    return duplicates


def audit_active_rows(rows: list[dict]) -> dict[str, list[dict]]:
    groups = classify_rows(rows)
    outside = groups["Outside"]
    outside_ids = {int(row["id"]) for row in outside}
    eligible = [row for row in rows if int(row["id"]) not in outside_ids]
    duplicates = find_exact_duplicates(eligible)
    return {
        "DFW": groups["DFW"],
        "Remote": groups["Remote"],
        "geography": outside,
        "duplicates": duplicates,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Mark audited rows inactive.")
    parser.add_argument(
        "--api-url",
        help="Audit a deployed public /jobs/ response without database credentials (read-only).",
    )
    parser.add_argument(
        "--confirm",
        help="Required with --apply; must be exactly DEACTIVATE. Enables non-interactive deployment use.",
    )
    args = parser.parse_args()
    if args.apply and args.confirm != "DEACTIVATE":
        parser.error("--apply requires --confirm DEACTIVATE")
    if args.apply and args.api_url:
        parser.error("--apply cannot be used with --api-url")

    if args.api_url:
        with urlopen(args.api_url, timeout=30) as response:
            payload = json.load(response)
        if isinstance(payload, dict):
            payload = payload.get("items") or []
        rows = [
            {
                **row,
                "job_title": row.get("title"),
                "work_style": row.get("hybrid"),
                "job_description": row.get("fullDescription") or row.get("description"),
                "canonical_url": row.get("applicationLink"),
                "application_link": row.get("applicationLink"),
            }
            for row in payload
            if isinstance(row, dict)
        ]
        return _report(rows, apply=False, cursor=None, connection=None)

    from database.connection import get_connection
    connection = get_connection()
    cursor = connection.cursor(dictionary=True)
    try:
        cursor.execute(
            "SELECT id, job_title, company, location, work_style, job_description, "
            "source, source_job_id, canonical_url, application_link "
            "FROM job_data WHERE active = TRUE ORDER BY id DESC"
        )
        rows = cursor.fetchall()
        return _report(rows, apply=args.apply, cursor=cursor, connection=connection)
    except Exception:
        connection.rollback()
        raise
    finally:
        cursor.close()
        connection.close()


def _report(rows, *, apply, cursor, connection) -> int:
    audit = audit_active_rows(rows)
    candidates = [
        *(dict(row, category="geography") for row in audit["geography"]),
        *(dict(row, category="duplicate") for row in audit["duplicates"]),
    ]
    print(
        f"[policy] active={len(rows)} dfw={len(audit['DFW'])} "
        f"remote={len(audit['Remote'])} geography={len(audit['geography'])} "
        f"duplicates={len(audit['duplicates'])} would_deactivate={len(candidates)}",
        flush=True,
    )
    for row in candidates:
        print(
            f"[policy] candidate id={row['id']} category={row['category']} "
            f"location={row.get('location')!r} company={row.get('company')!r} "
            f"title={row.get('job_title')!r} reason={row['reason']}",
            flush=True,
        )

    if not apply:
        print("[policy] dry run only; changed=0 deleted=0", flush=True)
        return 0
    if candidates:
        cursor.executemany(
            "UPDATE job_data SET active = FALSE, last_checked_at = CURRENT_TIMESTAMP "
            "WHERE id = %s AND active = TRUE",
            [(row["id"],) for row in candidates],
        )
        changed = cursor.rowcount
        connection.commit()
    else:
        changed = 0
    print(
        f"[policy] deactivated={changed} geography={len(audit['geography'])} "
        f"duplicates={len(audit['duplicates'])} deleted=0",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
