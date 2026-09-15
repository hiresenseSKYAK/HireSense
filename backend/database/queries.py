try:
    from backend.database.connection import DB_NAME, get_connection
except ImportError:
    try:
        from database.connection import DB_NAME, get_connection
    except ImportError:
        from connection import DB_NAME, get_connection

import json
import mysql.connector

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


def insert_job(job):
    """Insert one job row. Returns True on success, False if skipped or failed."""
    ensure_job_description_summary_column()
    conn = get_connection()
    cursor = conn.cursor()

    salary_value = _sanitize_salary_for_db(job.get("salary"))
    title = job.get("job_title")
    job_type_value = _normalize_job_type_for_db(job.get("job_type"), title)
    experience_level_value = _normalize_experience_level_for_db(
        job.get("experience_level"),
        title,
    )
    work_style_value = _normalize_work_style_for_db(job.get("work_style"))
    summary = _nonempty_str(job.get("job_description_summary"))

    if experience_level_value not in TARGET_EXPERIENCE_LEVELS:
        print(
            f"[db] insert_job SKIP non-target experience: "
            f"title={title!r} experience={job.get('experience_level')!r}",
            flush=True,
        )
        return False

    columns = [
        "job_title",
        "company",
        "location",
        "salary",
        "date_posted",
        "application_link",
        "job_description",
        "job_description_summary",
        "skills",
        "job_type",
        "experience_level",
        "work_style",
    ]

    values = [
        title,
        job.get("company"),
        job.get("location"),
        salary_value,
        job.get("date_posted"),
        job.get("application_link"),
        job.get("job_description"),
        summary,
        json.dumps(job.get("skills", [])),
        job_type_value,
        experience_level_value,
        work_style_value,
    ]

    placeholders = ", ".join(["%s"] * len(values))
    column_sql = ", ".join(columns)
    query = f"""
        INSERT INTO job_data (
            {column_sql}
        )
        VALUES ({placeholders})
    """
    values = tuple(values)

    try:
        cursor.execute(query, values)
        conn.commit()
        row_id = cursor.lastrowid
        print(
            f"[db] insert_job OK: lastrowid={row_id}, title={job.get('job_title')!r}",
            flush=True,
        )
        return True
    except mysql.connector.DataError as exc:
        if getattr(exc, "errno", None) == 1264 and salary_value is not None:
            try:
                conn.rollback()
                values_no_salary = list(values)
                values_no_salary[3] = None
                cursor.execute(query, tuple(values_no_salary))
                conn.commit()
                row_id = cursor.lastrowid
                print(
                    f"[db] insert_job RETRY salary=NULL: lastrowid={row_id}, title={job.get('job_title')!r}",
                    flush=True,
                )
                return True
            except mysql.connector.Error as retry_exc:
                conn.rollback()
                print(
                    f"[db] insert_job FAILED (retry): {retry_exc!r} | title={job.get('job_title')!r}",
                    flush=True,
                )
                return False
        conn.rollback()
        print(
            f"[db] insert_job FAILED (data): {exc!r} | title={job.get('job_title')!r}",
            flush=True,
        )
        return False
    except mysql.connector.IntegrityError as exc:
        conn.rollback()
        if getattr(exc, "errno", None) == 1062:
            print(
                f"[db] insert_job SKIP duplicate: title={job.get('job_title')!r}",
                flush=True,
            )
            return False
        print(
            f"[db] insert_job FAILED (integrity): {exc!r} | title={job.get('job_title')!r}",
            flush=True,
        )
        return False
    except mysql.connector.Error as exc:
        conn.rollback()
        print(
            f"[db] insert_job FAILED (db): {exc!r} | title={job.get('job_title')!r}",
            flush=True,
        )
        return False
    except Exception as exc:
        try:
            conn.rollback()
        except mysql.connector.Error:
            pass
        print(
            f"[db] insert_job FAILED: {exc!r} | title={job.get('job_title')!r}",
            flush=True,
        )
        return False
    finally:
        cursor.close()
        conn.close()


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
        WHERE date_posted IS NULL
            OR DATEDIFF(CURDATE(), date_posted) > 30;
        """
    )

    jobs = cursor.fetchall()

    cursor.close()
    conn.close()

    return jobs


def delete_job(job_id):
    conn = get_connection()
    cursor = conn.cursor()

    try:
        cursor.execute(
            """
            DELETE ir FROM interview_responses ir
            INNER JOIN interview_sessions i ON ir.session_id = i.id
            WHERE i.job_id = %s
            """,
            (job_id,),
        )
        cursor.execute(
            "DELETE FROM interview_sessions WHERE job_id = %s",
            (job_id,),
        )
        cursor.execute("DELETE FROM saved_jobs WHERE job_id = %s", (job_id,))
        cursor.execute("DELETE FROM applied_jobs WHERE job_id = %s", (job_id,))
        cursor.execute("DELETE FROM job_data WHERE id = %s", (job_id,))
        conn.commit()
        return cursor.rowcount > 0
    except mysql.connector.Error as exc:
        conn.rollback()
        print(
            f"[db] delete_job FAILED: {exc!r} | id={job_id!r}",
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