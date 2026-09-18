try:
    from backend.database.connection import DB_NAME, get_connection
except ImportError:
    try:
        from database.connection import DB_NAME, get_connection
    except ImportError:
        from connection import DB_NAME, get_connection

import json
import mysql.connector
from dataclasses import dataclass

try:
    from backend.database.job_identity import build_job_identity
except ImportError:
    from database.job_identity import build_job_identity

try:
    from backend.services.job_relevance import assess_job_relevance
except ImportError:
    from services.job_relevance import assess_job_relevance
try:
    from backend.services.job_experience import assess_job_experience
except ImportError:
    from services.job_experience import assess_job_experience

_JOB_SUMMARY_COLUMN_READY = False


ALLOWED_JOB_TYPES = {
    "full-time": "Full-time",
    "part-time": "Part-time",
    "contract": "Contract",
    "internship": "Internship",
    "temporary": "Temporary",
}

ALLOWED_EXPERIENCE_LEVELS = {
    "internship": "Internship",
    "entry level": "Entry level",
}

TARGET_EXPERIENCE_LEVELS = {"Internship", "Entry level"}


def _normalize_job_type_for_db(raw, title=None):
    title_text = (title or "").lower()

    if "intern" in title_text:
        return "Internship"

    if not raw:
        return "Full-time"

    value = str(raw).strip()
    lower = value.lower()

    if lower in ALLOWED_JOB_TYPES:
        return ALLOWED_JOB_TYPES[lower]

    if "intern" in lower:
        return "Internship"
    if "contract" in lower:
        return "Contract"
    if "part" in lower:
        return "Part-time"
    if "temp" in lower:
        return "Temporary"
    if "full" in lower:
        return "Full-time"

    return "Full-time"


def _normalize_experience_level_for_db(raw, title=None):
    title_text = (title or "").lower()
    if "intern" in title_text:
        return "Internship"

    if not raw:
        return None

    value = str(raw).strip()
    lower = value.lower()

    if lower in ALLOWED_EXPERIENCE_LEVELS:
        return ALLOWED_EXPERIENCE_LEVELS[lower]

    if "intern" in lower:
        return "Internship"
    if "entry" in lower or "junior" in lower:
        return "Entry level"

    return None


def _normalize_work_style_for_db(raw):
    if not raw:
        return "On-site"

    value = str(raw).strip()
    lower = value.lower()

    if "remote" in lower:
        return "Remote"
    if "hybrid" in lower:
        return "Hybrid"
    if "site" in lower or "office" in lower or "on-site" in lower:
        return "On-site"

    return "On-site"


def _safe_load_skills(raw):
    if not raw:
        return []
    if isinstance(raw, list):
        return raw

    try:
        data = json.loads(raw)
        if isinstance(data, list):
            return [str(item) for item in data]
    except Exception:
        pass

    return []


def ensure_job_description_summary_column():
    """Add job_description_summary to existing MySQL tables. create_all will not alter them."""
    global _JOB_SUMMARY_COLUMN_READY
    if _JOB_SUMMARY_COLUMN_READY:
        return

    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            SELECT COUNT(*)
            FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = %s
              AND TABLE_NAME = 'job_data'
              AND COLUMN_NAME = 'job_description_summary'
            """,
            (DB_NAME,),
        )
        exists = cursor.fetchone()[0] > 0
        if not exists:
            try:
                cursor.execute(
                    "ALTER TABLE job_data ADD COLUMN job_description_summary TEXT NULL"
                )
                conn.commit()
                print("[db] added job_data.job_description_summary", flush=True)
            except mysql.connector.Error as exc:
                if getattr(exc, "errno", None) != 1060:
                    raise
        _JOB_SUMMARY_COLUMN_READY = True
    finally:
        cursor.close()
        conn.close()


def _map_db_row_to_frontend_job(row):
    skills = _safe_load_skills(row.get("skills"))

    work_style = row.get("work_style") or "On-site"
    job_type = row.get("job_type") or "Full-time"
    experience_level = row.get("experience_level") or "Entry level"
    salary = row.get("salary") or "Not listed"
    date_posted = row.get("date_posted")
    original_description = row.get("job_description") or "No description available."
    summary = (row.get("job_description_summary") or "").strip()
    card_description = summary or original_description

    posted = str(date_posted) if date_posted else "Recently posted"

    return {
        "id": row.get("id"),
        "title": row.get("job_title") or "Untitled Role",
        "company": row.get("company") or "Unknown Company",
        "location": row.get("location") or "Unknown Location",
        "type": job_type,
        "salary": salary,
        "salaryRange": salary,
        "tags": skills,
        "posted": posted,
        "badge": "Live",
        "match": 0,
        "logo": "",
        "hybrid": work_style,
        "experienceLevel": experience_level,
        "dateRange": "Live",
        "description": card_description,
        "fullDescription": original_description,
        "applicationLink": row.get("application_link") or "",
    }


def _nonempty_str(value):
    if value is None:
        return None
    s = str(value).strip()
    return s if s else None


def _sanitize_salary_for_db(raw_salary):
    if raw_salary is None:
        return None
    try:
        value = int(raw_salary)
    except (TypeError, ValueError):
        return None
    if value < 0:
        return None
    if value > 2_147_483_647:
        return None
    return value


@dataclass(frozen=True)
class JobWriteResult:
    action: str
    job_id: int | None = None
    changed_fields: tuple[str, ...] = ()
    reason: str = ""


_JOB_WRITE_COLUMNS = (
    "source", "source_job_id", "job_title", "company", "location", "salary",
    "date_posted", "application_link", "canonical_url", "identity_key",
    "job_description", "job_description_summary", "skills", "job_type",
    "experience_level", "work_style",
)


def _prepare_job_record(job):
    salary_value = _sanitize_salary_for_db(job.get("salary"))
    title = _nonempty_str(job.get("job_title"))
    company = _nonempty_str(job.get("company"))
    if not title or not company:
        return None, "missing required title or company"
    relevance = assess_job_relevance(title, job.get("job_description"))
    if not relevance.relevant:
        return None, relevance.reason
    experience = assess_job_experience(
        title, job.get("job_description"), job.get("experience_level")
    )
    if not experience.accepted:
        return None, experience.reason
    job_type_value = _normalize_job_type_for_db(job.get("job_type"), title)
    experience_level_value = experience.level
    work_style_value = _normalize_work_style_for_db(job.get("work_style"))
    summary = _nonempty_str(job.get("job_description_summary"))
    if experience_level_value not in TARGET_EXPERIENCE_LEVELS:
        return None, "non-target experience level"
    identity = build_job_identity(job)
    if identity is None:
        return None, "no stable source id, canonical URL, or complete fallback identity"
    if identity.canonical_url is None:
        return None, "invalid or missing HTTP(S) application URL"
    return {
        "source": identity.source,
        "source_job_id": identity.source_job_id,
        "job_title": title,
        "company": company,
        "location": _nonempty_str(job.get("location")),
        "salary": salary_value,
        "date_posted": job.get("date_posted"),
        "application_link": identity.canonical_url,
        "canonical_url": identity.canonical_url,
        "identity_key": identity.identity_key,
        "job_description": _nonempty_str(job.get("job_description")),
        "job_description_summary": summary,
        "skills": json.dumps(job.get("skills") if isinstance(job.get("skills"), list) else []),
        "job_type": job_type_value,
        "experience_level": experience_level_value,
        "work_style": work_style_value,
    }, identity.strategy


def _record_changes(existing, incoming):
    changes = {}
    preserve_when_blank = {
        "company", "location", "salary", "date_posted", "application_link",
        "canonical_url", "job_description", "job_description_summary", "source",
        "source_job_id",
    }
    for column in _JOB_WRITE_COLUMNS:
        value = incoming[column]
        if column in preserve_when_blank and value in (None, ""):
            continue
        if column == "skills" and value == "[]" and existing.get(column) not in (None, "", "[]"):
            continue
        existing_value = existing.get(column)
        if column == "date_posted":
            # mysql-connector returns DATE columns as datetime.date while the
            # crawlers provide YYYY-MM-DD strings. Treat equivalent values as
            # unchanged so a repeated crawl remains a true no-op.
            values_match = str(existing_value or "") == str(value or "")
        else:
            values_match = existing_value == value
        if not values_match:
            changes[column] = value
    return changes


class _MySQLJobRepository:
    def __init__(self):
        self.connection = get_connection()
        self.cursor = self.connection.cursor(dictionary=True)

    def find_matches(self, record):
        clauses = ["identity_key = %s"]
        params = [record["identity_key"]]
        if record.get("source") and record.get("source_job_id"):
            clauses.append("(source = %s AND source_job_id = %s)")
            params.extend([record["source"], record["source_job_id"]])
        if record.get("canonical_url"):
            clauses.append("canonical_url = %s")
            params.append(record["canonical_url"])
        if record.get("application_link"):
            clauses.append("application_link = %s")
            params.append(record["application_link"])
        self.cursor.execute(
            f"SELECT id, {', '.join(_JOB_WRITE_COLUMNS)} FROM job_data "
            f"WHERE {' OR '.join(clauses)} ORDER BY id LIMIT 2 FOR UPDATE",
            tuple(params),
        )
        return self.cursor.fetchall()

    def insert(self, record):
        placeholders = ", ".join(["%s"] * len(_JOB_WRITE_COLUMNS))
        self.cursor.execute(
            f"INSERT INTO job_data ({', '.join(_JOB_WRITE_COLUMNS)}) VALUES ({placeholders})",
            tuple(record[column] for column in _JOB_WRITE_COLUMNS),
        )
        return self.cursor.lastrowid

    def update(self, job_id, changes):
        assignments = ", ".join(f"{column} = %s" for column in changes)
        self.cursor.execute(
            f"UPDATE job_data SET {assignments}, last_seen_at = CURRENT_TIMESTAMP, "
            "last_checked_at = CURRENT_TIMESTAMP, active = TRUE WHERE id = %s",
            tuple(changes.values()) + (job_id,),
        )

    def touch_seen(self, job_id):
        self.cursor.execute(
            """
            UPDATE job_data
            SET last_seen_at = CURRENT_TIMESTAMP,
                last_checked_at = CURRENT_TIMESTAMP,
                active = TRUE
            WHERE id = %s
            """,
            (job_id,),
        )

    def commit(self):
        self.connection.commit()

    def rollback(self):
        self.connection.rollback()

    def close(self):
        self.cursor.close()
        self.connection.close()


def upsert_job(job, *, dry_run=False, repository_factory=None):
    """Insert, update, or skip one job by stable identity."""
    record, identity_strategy = _prepare_job_record(job)
    if record is None:
        return JobWriteResult("skipped", reason=identity_strategy)
    if not dry_run:
        ensure_job_description_summary_column()
    repository = (repository_factory or _MySQLJobRepository)()
    try:
        matches = repository.find_matches(record)
        if len(matches) > 1:
            repository.rollback()
            return JobWriteResult("conflict", reason="identity matched multiple existing rows")
        if matches:
            existing = matches[0]
            changes = _record_changes(existing, record)
            if not changes:
                if dry_run:
                    repository.rollback()
                else:
                    repository.touch_seen(existing["id"])
                    repository.commit()
                return JobWriteResult("unchanged", job_id=existing["id"], reason=identity_strategy)
            if dry_run:
                repository.rollback()
                return JobWriteResult("would_update", job_id=existing["id"], changed_fields=tuple(changes), reason=identity_strategy)
            repository.update(existing["id"], changes)
            repository.commit()
            return JobWriteResult("updated", job_id=existing["id"], changed_fields=tuple(changes), reason=identity_strategy)
        if dry_run:
            repository.rollback()
            return JobWriteResult("would_insert", reason=identity_strategy)
        job_id = repository.insert(record)
        repository.commit()
        return JobWriteResult("inserted", job_id=job_id, reason=identity_strategy)
    except mysql.connector.IntegrityError as exc:
        repository.rollback()
        if getattr(exc, "errno", None) == 1062:
            # A unique index closes the race between SELECT and INSERT. Resolve the
            # winner explicitly instead of treating every 1062 as a harmless skip.
            matches = repository.find_matches(record)
            if len(matches) == 1:
                existing = matches[0]
                changes = _record_changes(existing, record)
                if changes:
                    repository.update(existing["id"], changes)
                    repository.commit()
                    return JobWriteResult("updated", job_id=existing["id"], changed_fields=tuple(changes), reason="concurrent identity match")
                repository.touch_seen(existing["id"])
                repository.commit()
                return JobWriteResult("unchanged", job_id=existing["id"], reason="concurrent identity match")
        return JobWriteResult("error", reason=f"integrity error: {exc}")
    except mysql.connector.Error as exc:
        repository.rollback()
        return JobWriteResult("error", reason=f"database error: {exc}")
    finally:
        repository.close()


def insert_job(job):
    """Compatibility wrapper for older callers."""
    return upsert_job(job).action in {"inserted", "updated"}


def fetch_jobs_missing_summaries():
    """Rows that still need a card summary after crawl."""
    ensure_job_description_summary_column()
    conn = get_connection()
    cursor = conn.cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT
                id,
                job_title,
                company,
                job_description
            FROM job_data
            WHERE job_description IS NOT NULL
              AND TRIM(job_description) <> ''
              AND (
                    job_description_summary IS NULL
                    OR TRIM(job_description_summary) = ''
              )
            ORDER BY id DESC
            """
        )
        return cursor.fetchall()
    finally:
        cursor.close()
        conn.close()


def update_job_description_summary(job_id, summary):
    ensure_job_description_summary_column()
    summary_text = _nonempty_str(summary)
    if job_id is None or not summary_text:
        return False

    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            UPDATE job_data
            SET job_description_summary = %s
            WHERE id = %s
            """,
            (summary_text, job_id),
        )
        conn.commit()
        return cursor.rowcount > 0
    except mysql.connector.Error as exc:
        conn.rollback()
        print(
            f"[db] update_job_description_summary FAILED: {exc!r} | id={job_id!r}",
            flush=True,
        )
        return False
    finally:
        cursor.close()
        conn.close()


def fetch_jobs_for_skill_backfill(only_empty=True):
    """Rows that still need JobBERT skills, or every job with a description."""
    conn = get_connection()
    cursor = conn.cursor(dictionary=True)
    try:
        empty_filter = ""
        if only_empty:
            empty_filter = """
              AND (
                    skills IS NULL
                    OR TRIM(skills) = ''
                    OR TRIM(skills) = '[]'
              )
            """
        cursor.execute(
            f"""
            SELECT
                id,
                job_title,
                company,
                job_description,
                skills
            FROM job_data
            WHERE job_description IS NOT NULL
              AND TRIM(job_description) <> ''
              {empty_filter}
            ORDER BY id DESC
            """
        )
        return cursor.fetchall()
    finally:
        cursor.close()
        conn.close()


def update_job_skills(job_id, skills):
    if job_id is None:
        return False

    payload = json.dumps(skills or [])
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            UPDATE job_data
            SET skills = %s
            WHERE id = %s
            """,
            (payload, job_id),
        )
        conn.commit()
        return cursor.rowcount > 0
    except mysql.connector.Error as exc:
        conn.rollback()
        print(
            f"[db] update_job_skills FAILED: {exc!r} | id={job_id!r}",
            flush=True,
        )
        return False
    finally:
        cursor.close()
        conn.close()


def get_jobs_to_check():
    conn = get_connection()
    cursor = conn.cursor(dictionary=True)

    cursor.execute(
        """
        SELECT id, application_link
        FROM job_data
        WHERE active = TRUE
          AND (date_posted IS NULL OR DATEDIFF(CURDATE(), date_posted) > 30)
          AND (
                last_checked_at IS NULL
                OR last_checked_at < (CURRENT_TIMESTAMP - INTERVAL 7 DAY)
              )
        """
    )

    jobs = cursor.fetchall()

    cursor.close()
    conn.close()

    return jobs


def update_job_check_status(job_id, *, active=None):
    conn = get_connection()
    cursor = conn.cursor()

    try:
        if active is None:
            cursor.execute(
                "UPDATE job_data SET last_checked_at = CURRENT_TIMESTAMP WHERE id = %s",
                (job_id,),
            )
        else:
            cursor.execute(
                """
                UPDATE job_data
                SET active = %s, last_checked_at = CURRENT_TIMESTAMP
                WHERE id = %s
                """,
                (bool(active), job_id),
            )
        conn.commit()
        return cursor.rowcount > 0
    except mysql.connector.Error as exc:
        conn.rollback()
        print(
            f"[db] update_job_check_status FAILED: {exc!r} | id={job_id!r}",
            flush=True,
        )
        return False
    finally:
        cursor.close()
        conn.close()


def fetch_all_jobs_from_db():
    ensure_job_description_summary_column()
    conn = get_connection()
    cursor = conn.cursor(dictionary=True)

    cursor.execute(
        """
        SELECT
            id,
            job_title,
            company,
            location,
            salary,
            date_posted,
            application_link,
            job_description,
            job_description_summary,
            skills,
            job_type,
            experience_level,
            work_style
        FROM job_data
        WHERE experience_level IN ('Internship', 'Entry level')
          AND active = TRUE
        ORDER BY id DESC
        """
    )

    rows = cursor.fetchall()

    cursor.close()
    conn.close()

    return [_map_db_row_to_frontend_job(row) for row in rows]


def fetch_job_by_id_from_db(job_id: int):
    ensure_job_description_summary_column()
    conn = get_connection()
    cursor = conn.cursor(dictionary=True)

    cursor.execute(
        """
        SELECT
            id,
            job_title,
            company,
            location,
            salary,
            date_posted,
            application_link,
            job_description,
            job_description_summary,
            skills,
            job_type,
            experience_level,
            work_style
        FROM job_data
        WHERE id = %s
          AND experience_level IN ('Internship', 'Entry level')
          AND active = TRUE
        LIMIT 1
        """,
        (job_id,),
    )

    row = cursor.fetchone()

    cursor.close()
    conn.close()

    if not row:
        return None

    return _map_db_row_to_frontend_job(row)
