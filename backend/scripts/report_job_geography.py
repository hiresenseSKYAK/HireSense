"""Report legacy job geography and optionally deactivate out-of-policy rows."""

from __future__ import annotations

import argparse

from database.connection import get_connection
from services.job_location import assess_job_location


def classify_rows(rows):
    groups = {"DFW": [], "Remote": [], "Outside": []}
    for row in rows:
        job_id, title, company, location, work_style, active = row
        decision = assess_job_location(location, work_style)
        category = decision.category if decision.accepted else "Outside"
        groups[category].append(
            {
                "id": job_id,
                "title": title,
                "company": company,
                "location": location,
                "work_style": work_style,
                "active": bool(active),
                "reason": decision.reason,
            }
        )
    return groups


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Mark active out-of-policy rows inactive after an explicit confirmation.",
    )
    args = parser.parse_args()

    connection = get_connection()
    cursor = connection.cursor()
    try:
        cursor.execute(
            "SELECT id, job_title, company, location, work_style, active "
            "FROM job_data ORDER BY id"
        )
        rows = cursor.fetchall()
        groups = classify_rows(rows)
        outside_active = [row for row in groups["Outside"] if row["active"]]
        print(
            f"[geography] total={len(rows)} dfw={len(groups['DFW'])} "
            f"remote={len(groups['Remote'])} outside={len(groups['Outside'])} "
            f"would_deactivate={len(outside_active)}",
            flush=True,
        )
        for row in outside_active:
            print(
                f"[geography] candidate id={row['id']} location={row['location']!r} "
                f"work_style={row['work_style']!r} title={row['title']!r} "
                f"company={row['company']!r} reason={row['reason']}",
                flush=True,
            )

        if not args.apply:
            print("[geography] dry run only; no rows changed", flush=True)
            return 0
        if input("Type DEACTIVATE to mark these rows inactive: ").strip() != "DEACTIVATE":
            print("[geography] cancelled; no rows changed", flush=True)
            return 0
        if outside_active:
            cursor.executemany(
                "UPDATE job_data SET active = FALSE, last_checked_at = CURRENT_TIMESTAMP WHERE id = %s",
                [(row["id"],) for row in outside_active],
            )
            connection.commit()
        print(f"[geography] deactivated={len(outside_active)} deleted=0", flush=True)
        return 0
    except Exception:
        connection.rollback()
        raise
    finally:
        cursor.close()
        connection.close()


if __name__ == "__main__":
    raise SystemExit(main())
