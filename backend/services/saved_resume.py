"""Keep each signed-in user's latest resume analysis in the database.

Before this, the analysis lived only in the browser's localStorage, which is
cleared on logout, so the resume was gone after signing in again. Only the
JSON that /resume/upload returns (parsed details, score, applicant profile) is
stored, never the original file.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

from database.connection import SessionLocal
from database.models import UserResume

logger = logging.getLogger(__name__)

# The upload response is a few KB; refuse anything far larger rather than storing junk.
MAX_ANALYSIS_BYTES = 1_000_000


def save_resume(user_id: int, result: dict) -> str | None:
    """Store result for user_id and return its saved_at time, or None if it could not be saved."""
    saved_at = datetime.now(timezone.utc).isoformat()
    payload = json.dumps({**result, "saved_at": saved_at}, ensure_ascii=False)
    if len(payload.encode("utf-8")) > MAX_ANALYSIS_BYTES:
        logger.warning("resume analysis for user %s is too large to save", user_id)
        return None
    db = SessionLocal()
    try:
        row = db.get(UserResume, user_id)
        if row is None:
            row = UserResume(user_id=user_id)
            db.add(row)
        row.filename = str(result.get("filename") or "resume")[:255]
        row.analysis_json = payload
        row.updated_at = datetime.utcnow()
        db.commit()
        return saved_at
    except Exception:
        db.rollback()
        logger.exception("could not save resume analysis for user %s", user_id)
        return None
    finally:
        db.close()


def load_resume(user_id: int) -> dict | None:
    db = SessionLocal()
    try:
        row = db.get(UserResume, user_id)
        if row is None:
            return None
        try:
            data = json.loads(row.analysis_json)
        except (TypeError, ValueError):
            logger.warning("stored resume analysis for user %s is unreadable", user_id)
            return None
        return data if isinstance(data, dict) else None
    finally:
        db.close()


def delete_resume(user_id: int) -> bool:
    db = SessionLocal()
    try:
        deleted = db.query(UserResume).filter(UserResume.user_id == user_id).delete()
        db.commit()
        return bool(deleted)
    finally:
        db.close()
