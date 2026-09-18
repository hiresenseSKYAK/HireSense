"""Apply tracked additive SQL migrations to the configured MySQL database."""

from __future__ import annotations

import argparse
from pathlib import Path

from database.connection import get_connection


MIGRATIONS_DIR = Path(__file__).with_name("migrations")


def _statements(sql: str):
    without_comments = "\n".join(
        line for line in sql.splitlines() if not line.lstrip().startswith("--")
    )
    return [statement.strip() for statement in without_comments.split(";") if statement.strip()]


def migrate(*, through: int | None = None) -> list[str]:
    connection = get_connection()
    cursor = connection.cursor()
    applied_now = []
    try:
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version VARCHAR(255) PRIMARY KEY,
                applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        connection.commit()
        cursor.execute("SELECT version FROM schema_migrations")
        applied = {row[0] for row in cursor.fetchall()}

        for path in sorted(MIGRATIONS_DIR.glob("[0-9][0-9][0-9]_*.sql")):
            number = int(path.name[:3])
            if through is not None and number > through:
                continue
            if path.name in applied:
                print(f"[migrate] already applied: {path.name}", flush=True)
                continue
            print(f"[migrate] applying: {path.name}", flush=True)
            for statement in _statements(path.read_text(encoding="utf-8")):
                cursor.execute(statement)
            cursor.execute(
                "INSERT INTO schema_migrations (version) VALUES (%s)",
                (path.name,),
            )
            connection.commit()
            applied_now.append(path.name)
        return applied_now
    except Exception:
        connection.rollback()
        raise
    finally:
        cursor.close()
        connection.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--through", type=int, help="Apply migrations only through this number.")
    args = parser.parse_args()
    migrate(through=args.through)
    print("[migrate] complete", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
