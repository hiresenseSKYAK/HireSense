"""One-off repair: fix stored salaries that are above the sanity limit.

Older crawler code could multiply an annual salary by a pay period (for example
"$58,400 - $98,200 annually" next to "5 days per week" became $4,071,600). This
re-reads each such job's stored description with the fixed parser. When the
description gives a valid salary it is saved; otherwise the salary is cleared
(shown as "Not listed").

New crawls already apply the fix, so this only repairs rows saved earlier.

Usage (from backend, with the DB_* variables set):
    python -m scripts.fix_salaries          # list the changes only (dry run)
    python -m scripts.fix_salaries --apply  # save them
"""

from __future__ import annotations

from crawler.parsers.linkedin import _extract_salary_from_description, _normalize_salary_to_annual
from database.connection import get_connection
from database.queries import MAX_STORED_SALARY


def fix_salaries(*, dry_run: bool = True) -> list[tuple[int, int, int | None]]:
    conn = get_connection()
    cursor = conn.cursor(dictionary=True)
    try:
        cursor.execute(
            "SELECT id, salary, job_description FROM job_data WHERE salary > %s",
            (MAX_STORED_SALARY,),
        )
        changes = []
        for row in cursor.fetchall():
            description = row["job_description"] or ""
            salary_text = _extract_salary_from_description(description)
            new_salary = _normalize_salary_to_annual(salary_text, description) if salary_text else None
            changes.append((row["id"], row["salary"], new_salary))
        if not dry_run:
            for job_id, _, new_salary in changes:
                cursor.execute("UPDATE job_data SET salary = %s WHERE id = %s", (new_salary, job_id))
            conn.commit()
        return changes
    finally:
        cursor.close()
        conn.close()


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    results = fix_salaries(dry_run=not args.apply)
    for job_id, old, new in results:
        print(f"[salary] job {job_id}: {old:,} -> {f'{new:,}' if new is not None else 'Not listed'}")
    print(f"[salary] {'fixed' if args.apply else 'would fix'}={len(results)}")
