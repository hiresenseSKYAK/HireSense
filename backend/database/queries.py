try:
    from backend.database.connection import DB_NAME, get_connection
except ImportError:
    try:
        from database.connection import DB_NAME, get_connection
    except ImportError:
        from connection import DB_NAME, get_connection

import json
import os
import re
from datetime import date, datetime, timedelta
import mysql.connector
from dataclasses import dataclass
from urllib.parse import urlsplit

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
try:
    from backend.services.job_location import assess_job_geography
    from backend.services.job_deduplication import partition_unique_postings
except ImportError:
    from services.job_location import assess_job_geography
    from services.job_deduplication import partition_unique_postings
try:
    from backend.services.job_card import card_summary_line, internship_details
except ImportError:
    from services.job_card import card_summary_line, internship_details

_JOB_SUMMARY_COLUMN_READY = False

# ---------------------------------------------------------------------------
# Job lifecycle policy
# ---------------------------------------------------------------------------
# A job is shown for at most JOB_MAX_AGE_DAYS after its posting date. When the
# source gives no posting date, the day the crawler first found it is used.
JOB_MAX_AGE_DAYS = max(1, int(os.getenv("JOB_MAX_AGE_DAYS", "30") or 30))
# The age a row has, in SQL: posting date, or first-seen date when missing.
JOB_AGE_DATE_SQL = "COALESCE(date_posted, DATE(first_seen_at))"
# Employer boards whose feed is the authoritative list of open jobs.
DIRECT_FEED_SOURCES = {"greenhouse", "lever", "ashby"}
# Complete feed snapshots a job must be missing from, in a row, before closing.
MISSED_SNAPSHOTS_TO_CLOSE = 2


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
LOCATION_MAX_LENGTH = 512


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
    salary = row.get("salary") if row.get("salary") is not None else "Not listed"
    date_posted = row.get("date_posted")
    original_description = row.get("job_description") or "No description available."
    summary = (row.get("job_description_summary") or "").strip()
    card_description = summary or original_description

    posted = str(date_posted) if date_posted else None
    first_seen_at = row.get("first_seen_at")
    first_seen = first_seen_at.isoformat() if hasattr(first_seen_at, "isoformat") else str(first_seen_at or "") or None

    return {
        "id": row.get("id"),
        "title": row.get("job_title") or "Untitled Role",
        "company": row.get("company") or "Unknown Company",
        "companyLogoUrl": row.get("company_logo_url") or None,
        "location": row.get("location") or "Unknown Location",
        "type": job_type,
        "salary": salary,
        "salaryRange": salary,
        "tags": skills,
        "posted": posted,
        "datePosted": posted,
        "firstSeenAt": first_seen,
        "source": row.get("source") or None,
        "directEmployerListing": row.get("source") in {"greenhouse", "lever", "ashby"},
        "lastVerifiedAt": row.get("last_verified_at").isoformat() if hasattr(row.get("last_verified_at"), "isoformat") else None,
        "badge": None,
        "match": 0,
        "logo": row.get("company_logo_url") or "",
        "hybrid": work_style,
        "experienceLevel": experience_level,
        "dateRange": posted,
        "description": card_description,
        "fullDescription": original_description,
        "applicationLink": row.get("application_link") or "",
        # Only the job list query reads the stored AI summary; elsewhere this is None.
        "cardSummary": card_summary_line(
            row.get("ai_summary_json"), row.get("ai_summary_hash"), row.get("job_description")
        ),
        "internshipDetails": internship_details(
            row.get("job_title"), row.get("job_description"), experience_level, job_type
        ),
    }


def _nonempty_str(value):
    if value is None:
        return None
    s = str(value).strip()
    return s if s else None


def _normalize_location_for_db(value):
    """Keep distinct location labels within the location column's character limit."""
    if value is None:
        return None
    # Replace invalid surrogate code points before slicing so the result is UTF-8 encodable.
    raw = str(value).encode("utf-8", "replace").decode("utf-8")
    parts = re.split(r"\s*[;|\n\r]+\s*|\s+/\s+", raw)
    locations = []
    seen = set()
    for part in parts:
        normalized = " ".join(part.split()).strip(" ,")
        key = normalized.casefold()
        if normalized and key not in seen:
            locations.append(normalized)
            seen.add(key)
    concise = "; ".join(locations)
    if len(concise) <= LOCATION_MAX_LENGTH:
        return concise or None
    return concise[: LOCATION_MAX_LENGTH - 1].rstrip() + "…"


# Same ceiling as the description parser (crawler/parsers/linkedin.py MAX_ANNUAL_SALARY):
# a larger annual figure on this early-career board is a parsing mistake, so store nothing.
MAX_STORED_SALARY = 500_000


def _sanitize_salary_for_db(raw_salary):
    if raw_salary is None:
        return None
    try:
        value = int(raw_salary)
    except (TypeError, ValueError):
        return None
    if value < 0:
        return None
    if value > MAX_STORED_SALARY:
        return None
    return value


def _sanitize_http_url(raw_url):
    value = _nonempty_str(raw_url)
    if not value:
        return None
    try:
        parsed = urlsplit(value)
    except (TypeError, ValueError):
        return None
    if parsed.scheme.lower() not in {"http", "https"} or not parsed.hostname:
        return None
    if parsed.username or parsed.password:
        return None
    return value


@dataclass(frozen=True)
class JobWriteResult:
    action: str
    job_id: int | None = None
    changed_fields: tuple[str, ...] = ()
    reason: str = ""


_JOB_WRITE_COLUMNS = (
    "source", "source_job_id", "job_title", "company", "company_logo_url", "location", "salary",
    "date_posted", "application_link", "canonical_url", "identity_key",
    "job_description", "job_description_summary", "skills", "job_type",
    "experience_level", "work_style", "source_url", "source_feed_key", "source_updated_at", "status",
)

SOURCE_CONFIDENCE = {"greenhouse": 4, "lever": 4, "ashby": 4,
                     "usajobs": 3, "adzuna": 2, "linkedin": 1, "handshake": 1}


def _source_rank(source):
    return SOURCE_CONFIDENCE.get(str(source or "").lower(), 0)


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
    geography = assess_job_geography(
        job.get("location"), work_style_value, job.get("job_description"),
        scope="nationwide" if job.get("allow_relocation") else "dfw",
    )
    if not geography.accepted:
        return None, geography.reason
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
        "company_logo_url": _sanitize_http_url(job.get("company_logo_url")),
        "location": _normalize_location_for_db(job.get("location")),
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
        "source_url": _sanitize_http_url(job.get("source_url") or job.get("application_link")),
        "source_feed_key": _nonempty_str(job.get("source_feed_key")),
        "source_updated_at": job.get("source_updated_at"),
        "status": "active",
    }, identity.strategy


def _record_changes(existing, incoming):
    changes = {}
    preserve_when_blank = {
        "company", "company_logo_url", "location", "salary", "date_posted", "application_link",
        "canonical_url", "job_description", "job_description_summary", "source",
        "source_job_id",
        "source_url", "source_feed_key", "source_updated_at",
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
        elif column == "source_updated_at":
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
        if record.get("source") and record.get("source_job_id"):
            clauses.append("id IN (SELECT job_id FROM job_source_alias WHERE provider = %s AND source_job_id = %s)")
            params.extend([record["source"], record["source_job_id"]])
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
        job_id = self.cursor.lastrowid
        if record.get("source") in {"greenhouse", "lever", "ashby", "usajobs"}:
            self.cursor.execute("UPDATE job_data SET last_verified_at = CURRENT_TIMESTAMP WHERE id = %s", (job_id,))
        return job_id

    def record_alias(self, source, source_job_id, job_id):
        if source and source_job_id:
            self.cursor.execute(
                """INSERT INTO job_source_alias (provider, source_job_id, job_id)
                   VALUES (%s, %s, %s)
                   ON DUPLICATE KEY UPDATE last_seen_at = CURRENT_TIMESTAMP""",
                (source, source_job_id, job_id),
            )

    def update(self, job_id, changes, *, reactivate=True):
        assignments = "".join(f"{column} = %s, " for column in changes)
        # A hidden (expired/closed) job keeps active = FALSE; only metadata is refreshed.
        reactivation = "active = TRUE, " if reactivate else ""
        self.cursor.execute(
            f"UPDATE job_data SET {assignments}last_seen_at = CURRENT_TIMESTAMP, "
            f"last_checked_at = CURRENT_TIMESTAMP, {reactivation}"
            "last_verified_at = IF(source IN ('greenhouse','lever','ashby','usajobs'), CURRENT_TIMESTAMP, last_verified_at) WHERE id = %s",
            tuple(changes.values()) + (job_id,),
        )

    def touch_seen(self, job_id, *, reactivate=True):
        # A hidden (expired/closed) job only gets its "last seen" time refreshed.
        reactivation = "active = TRUE, status = 'active'," if reactivate else ""
        self.cursor.execute(
            f"""
            UPDATE job_data
            SET last_seen_at = CURRENT_TIMESTAMP,
                last_checked_at = CURRENT_TIMESTAMP,
                {reactivation}
                last_verified_at = IF(source IN ('greenhouse','lever','ashby','usajobs'), CURRENT_TIMESTAMP, last_verified_at)
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


def _posted_recently(value) -> bool:
    if not value:
        return False
    if isinstance(value, datetime):
        posted = value.date()
    elif isinstance(value, date):
        posted = value
    else:
        try:
            posted = datetime.strptime(str(value)[:10], "%Y-%m-%d").date()
        except ValueError:
            return False
    return posted >= date.today() - timedelta(days=JOB_MAX_AGE_DAYS)


def _stays_hidden(existing, record) -> bool:
    """Whether a re-crawled job that was hidden must stay hidden.

    - "expired" (too old) stays hidden unless the source now reports a fresh posting date.
    - "closed" stays hidden unless the job is back on its employer's own board
      (Greenhouse/Lever/Ashby), which is authoritative. Showing up again in a
      LinkedIn or Handshake search is not enough to bring it back.
    """
    status = existing.get("status")
    if status == "expired":
        return not _posted_recently(record.get("date_posted"))
    if status == "closed":
        return str(record.get("source") or "").lower() not in DIRECT_FEED_SOURCES
    return False


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
            better_existing = _source_rank(existing.get("source")) > _source_rank(record.get("source"))
            changes = {} if better_existing else _record_changes(existing, record)
            stay_hidden = _stays_hidden(existing, record)
            if stay_hidden:
                changes.pop("status", None)
            if not changes:
                if dry_run:
                    repository.rollback()
                else:
                    if hasattr(repository, "record_alias"):
                        repository.record_alias(record["source"], record["source_job_id"], existing["id"])
                    if not better_existing:
                        repository.touch_seen(existing["id"], reactivate=not stay_hidden)
                    repository.commit()
                return JobWriteResult("unchanged", job_id=existing["id"], reason="lower-confidence duplicate" if better_existing else identity_strategy)
            if dry_run:
                repository.rollback()
                return JobWriteResult("would_update", job_id=existing["id"], changed_fields=tuple(changes), reason=identity_strategy)
            repository.update(existing["id"], changes, reactivate=not stay_hidden)
            if hasattr(repository, "record_alias"):
                repository.record_alias(existing.get("source"), existing.get("source_job_id"), existing["id"])
                repository.record_alias(record["source"], record["source_job_id"], existing["id"])
            repository.commit()
            return JobWriteResult("updated", job_id=existing["id"], changed_fields=tuple(changes), reason=identity_strategy)
        if dry_run:
            repository.rollback()
            return JobWriteResult("would_insert", reason=identity_strategy)
        job_id = repository.insert(record)
        if hasattr(repository, "record_alias"):
            repository.record_alias(record["source"], record["source_job_id"], job_id)
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
                stay_hidden = _stays_hidden(existing, record)
                if stay_hidden:
                    changes.pop("status", None)
                if changes:
                    repository.update(existing["id"], changes, reactivate=not stay_hidden)
                    repository.commit()
                    return JobWriteResult("updated", job_id=existing["id"], changed_fields=tuple(changes), reason="concurrent identity match")
                repository.touch_seen(existing["id"], reactivate=not stay_hidden)
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


def get_jobs_to_check(*, linkedin_sweep=False):
    conn = get_connection()
    cursor = conn.cursor(dictionary=True)

    # Every visible job is link-checked, not just old ones: never-checked jobs
    # first, then "possibly closed" (recheck daily), then anything not checked
    # in 3 days. LinkedIn jobs are rechecked on every run (the checker runs
    # every 12 hours) because LinkedIn closes postings often and its guest page
    # states that directly. The 10-hour gap only skips jobs checked by an
    # overlapping run. With
    # linkedin_sweep, every visible LinkedIn job is checked regardless of when
    # it was last checked. Jobs past the age limit are skipped; the age rule
    # removes them.
    cursor.execute(
        f"""
        SELECT id, application_link, status, source, source_job_id
        FROM job_data
        WHERE active = TRUE
          AND {JOB_AGE_DATE_SQL} >= CURRENT_DATE - INTERVAL %s DAY
          AND (
                last_checked_at IS NULL
                OR (status = 'possibly_closed' AND last_checked_at < (CURRENT_TIMESTAMP - INTERVAL 1 DAY))
                OR (source = 'linkedin' AND (%s OR last_checked_at < (CURRENT_TIMESTAMP - INTERVAL 10 HOUR)))
                OR last_checked_at < (CURRENT_TIMESTAMP - INTERVAL 3 DAY)
              )
        ORDER BY (last_checked_at IS NULL) DESC,
                 (status = 'possibly_closed') DESC,
                 last_checked_at ASC
        """,
        (JOB_MAX_AGE_DAYS, bool(linkedin_sweep)),
    )

    jobs = cursor.fetchall()

    cursor.close()
    conn.close()

    return jobs


def record_feed_snapshot(feed_key, present_source_job_ids, *, board_listed_jobs=False):
    """Close employer-board jobs missing from complete feed snapshots.

    Called after a complete, error-free Greenhouse/Lever/Ashby crawl of one
    board. Jobs listed in the feed reset their miss counter; active jobs from
    that feed that were not listed get +1. A job missing from
    MISSED_SNAPSHOTS_TO_CLOSE snapshots in a row (about 30 minutes at the
    15-minute ATS cadence) is marked closed and hidden.

    board_listed_jobs=True means the board returned listings and none of them qualify,
    so an empty ``present_source_job_ids`` counts every active job as missing.

    Returns the number of jobs closed.
    """
    present = sorted({str(value) for value in present_source_job_ids if value})
    if not feed_key or (not present and not board_listed_jobs):
        # An empty board response is more likely a glitch than every job closing
        # at once; leave those jobs to the age rule and link checker.
        return 0
    placeholders = ", ".join(["%s"] * len(present))
    conn = get_connection()
    cursor = conn.cursor()
    try:
        if present:
            cursor.execute(
                f"UPDATE job_data SET missed_snapshots = 0 "
                f"WHERE source_feed_key = %s AND source_job_id IN ({placeholders})",
                (feed_key, *present),
            )
            cursor.execute(
                f"UPDATE job_data SET missed_snapshots = missed_snapshots + 1 "
                f"WHERE source_feed_key = %s AND active = TRUE "
                f"AND (source_job_id IS NULL OR source_job_id NOT IN ({placeholders}))",
                (feed_key, *present),
            )
        else:
            cursor.execute(
                "UPDATE job_data SET missed_snapshots = missed_snapshots + 1 "
                "WHERE source_feed_key = %s AND active = TRUE",
                (feed_key,),
            )
        cursor.execute(
            "UPDATE job_data SET active = FALSE, status = 'closed' "
            "WHERE source_feed_key = %s AND active = TRUE AND missed_snapshots >= %s",
            (feed_key, MISSED_SNAPSHOTS_TO_CLOSE),
        )
        closed = cursor.rowcount
        conn.commit()
        return closed
    except mysql.connector.Error as exc:
        conn.rollback()
        print(f"[db] record_feed_snapshot FAILED: {exc!r} | feed={feed_key!r}", flush=True)
        return 0
    finally:
        cursor.close()
        conn.close()


def expire_old_jobs(*, dry_run=True):
    """Hide jobs older than JOB_MAX_AGE_DAYS (posting date, else first-seen date).

    Rows are marked status = 'expired', active = FALSE rather than deleted, so
    interview history that points at a job keeps working. Returns the count.
    """
    predicate = f"active = TRUE AND {JOB_AGE_DATE_SQL} < CURRENT_DATE - INTERVAL %s DAY"
    conn = get_connection()
    cursor = conn.cursor()
    try:
        if dry_run:
            cursor.execute(f"SELECT COUNT(*) FROM job_data WHERE {predicate}", (JOB_MAX_AGE_DAYS,))
            return int(cursor.fetchone()[0])
        cursor.execute(
            f"UPDATE job_data SET status = 'expired', active = FALSE WHERE {predicate}",
            (JOB_MAX_AGE_DAYS,),
        )
        count = cursor.rowcount
        conn.commit()
        return count
    except Exception:
        conn.rollback()
        raise
    finally:
        cursor.close()
        conn.close()


def update_job_check_status(job_id, *, active=None, confirmed=False):
    """Record a link check.

    active=True: open. active=None: inconclusive. active=False: closure evidence;
    the first one marks "possibly_closed" and a second (a day later) closes the
    job, unless confirmed=True (the source itself said it is closed, e.g.
    LinkedIn's "No longer accepting applications"), which closes immediately.
    """
    conn = get_connection()
    cursor = conn.cursor()

    try:
        if active is False and confirmed:
            cursor.execute(
                "UPDATE job_data SET active = FALSE, status = 'closed', "
                "last_checked_at = CURRENT_TIMESTAMP WHERE id = %s",
                (job_id,),
            )
        elif active is None:
            cursor.execute(
                "UPDATE job_data SET last_checked_at = CURRENT_TIMESTAMP WHERE id = %s",
                (job_id,),
            )
        else:
            cursor.execute(
                """
                UPDATE job_data
                SET active = CASE WHEN %s = FALSE AND status = 'possibly_closed' THEN FALSE ELSE TRUE END,
                    status = CASE WHEN %s = TRUE THEN 'active'
                                  WHEN status = 'possibly_closed' THEN 'closed'
                                  ELSE 'possibly_closed' END,
                    last_verified_at = CASE WHEN %s = TRUE THEN CURRENT_TIMESTAMP ELSE last_verified_at END,
                    last_checked_at = CURRENT_TIMESTAMP
                WHERE id = %s
                """,
                (bool(active), bool(active), bool(active), job_id),
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


def fetch_all_jobs_from_db(*, scope="dfw"):
    ensure_job_description_summary_column()
    conn = get_connection()
    cursor = conn.cursor(dictionary=True)

    cursor.execute(
        f"""
        SELECT
            id,
            job_title,
            company,
            company_logo_url,
            location,
            salary,
            date_posted,
            application_link,
            job_description,
            job_description_summary,
            skills,
            job_type,
            experience_level,
            work_style,
            first_seen_at,
            source,
            source_job_id,
            canonical_url
            ,last_verified_at
            ,ai_summary.source_hash AS ai_summary_hash
            ,ai_summary.summary_json AS ai_summary_json
        FROM job_data
        LEFT JOIN job_ai_summaries AS ai_summary ON ai_summary.job_id = job_data.id
        WHERE experience_level IN ('Internship', 'Entry level')
          AND active = TRUE
          AND {JOB_AGE_DATE_SQL} >= CURRENT_DATE - INTERVAL %s DAY
        ORDER BY id DESC
        """,
        (JOB_MAX_AGE_DAYS,),
    )

    rows = cursor.fetchall()

    cursor.close()
    conn.close()

    return [
        _map_db_row_to_frontend_job(row)
        for row in _eligible_unique_rows(rows, scope=scope)
    ]


def fetch_job_by_id_from_db(job_id: int):
    ensure_job_description_summary_column()
    conn = get_connection()
    cursor = conn.cursor(dictionary=True)

    cursor.execute(
        f"""
        SELECT
            id,
            job_title,
            company,
            company_logo_url,
            location,
            salary,
            date_posted,
            application_link,
            job_description,
            job_description_summary,
            skills,
            job_type,
            experience_level,
            work_style,
            first_seen_at,
            source,
            source_job_id,
            canonical_url
            ,last_verified_at
        FROM job_data
        WHERE id = %s
          AND experience_level IN ('Internship', 'Entry level')
          AND active = TRUE
          AND {JOB_AGE_DATE_SQL} >= CURRENT_DATE - INTERVAL %s DAY
        LIMIT 1
        """,
        (job_id, JOB_MAX_AGE_DAYS),
    )

    row = cursor.fetchone()

    cursor.close()
    conn.close()

    if not row or not _row_is_geography_eligible(row, scope="nationwide"):
        return None

    return _map_db_row_to_frontend_job(row)


def _row_is_geography_eligible(row, *, scope="dfw"):
    return assess_job_geography(
        row.get("location"),
        row.get("work_style"),
        row.get("job_description"),
        scope=scope,
    ).accepted


def _eligible_unique_rows(rows, *, scope="dfw"):
    """Defense-in-depth guard for legacy rows and exact content reposts."""
    eligible = [row for row in rows if _row_is_geography_eligible(row, scope=scope)]
    unique, _duplicates = partition_unique_postings(eligible)
    return unique
