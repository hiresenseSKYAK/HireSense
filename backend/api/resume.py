import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, File, Header, HTTPException, Request, UploadFile
from starlette.concurrency import run_in_threadpool

from services.applicant_profile import build_applicant_profile
from services.file_extractor import extract_resume_links, extract_resume_text
from services.resume_parser import parse_resume_text
from services.resume_scorer import score_resume

router = APIRouter(prefix="/resume", tags=["resume"])
logger = logging.getLogger(__name__)

ALLOWED_EXTENSIONS = (".pdf", ".docx")
MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024


def _optional_user_id(authorization: Optional[str]) -> int | None:
    """Signed-in user id from "Bearer <token>", or None. Never raises: signed-out uploads still work."""
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    token = authorization[7:].strip()
    if not token:
        return None
    try:
        from database.connection import SessionLocal
        from database.models import UserSession

        db = SessionLocal()
        try:
            session = db.query(UserSession).filter(
                UserSession.token == token, UserSession.expires_at > datetime.utcnow(),
            ).first()
            return session.user_id if session else None
        finally:
            db.close()
    except Exception:
        logger.warning("Could not resolve resume uploader; using rules-only parsing")
        return None


@router.post("/upload")
async def upload_resume_endpoint(
    request: Request,
    file: UploadFile = File(...),
    authorization: Optional[str] = Header(default=None),
):
    # AI parsing (same OPENAI_API_KEY as the AI interview) is only used for
    # signed-in users so the key cannot be spent anonymously.
    user_id = await run_in_threadpool(_optional_user_id, authorization)
    resume_ai = getattr(request.app.state, "resume_ai_service", None)
    return await upload_resume(file, user_id=user_id, resume_ai=resume_ai)


async def upload_resume(file: UploadFile, *, user_id: int | None = None, resume_ai=None):
    filename = file.filename or ""

    if not filename:
        raise HTTPException(status_code=400, detail="No file was uploaded.")

    if not filename.lower().endswith(ALLOWED_EXTENSIONS):
        raise HTTPException(
            status_code=400,
            detail="Invalid file type. Please upload a PDF or DOCX resume.",
        )

    file_bytes = await file.read()

    if not file_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    if len(file_bytes) > MAX_FILE_SIZE_BYTES:
        raise HTTPException(
            status_code=400,
            detail="File is too large. Please upload a resume smaller than 5 MB.",
        )

    try:
        extracted_text = extract_resume_text(filename, file_bytes)
    except Exception:
        logger.exception("Could not extract text from resume file %r", filename)
        raise HTTPException(
            status_code=400,
            detail="We couldn't read this resume. Export it as a new PDF or DOCX file and try again.",
        )

    try:
        if not extracted_text.strip():
            raise HTTPException(
                status_code=400,
                detail="Could not extract text from the uploaded resume.",
            )

        parsed_data = parse_resume_text(extracted_text, extract_resume_links(filename, file_bytes))
        # Score the rules result so scores stay stable whether or not AI is available.
        scored_data = score_resume(parsed_data)
        parser_source, fallback_reason = "rules", "provider_unconfigured"
        if resume_ai is not None:
            parsed_data, parser_source, fallback_reason = await run_in_threadpool(
                resume_ai.enhance, user_id, extracted_text, parsed_data,
            )
        logger.info("resume_upload parser=%s fallback_reason=%s", parser_source, fallback_reason)

        return {
            "filename": filename,
            "parsed_data": {
                "name": parsed_data["name"],
                "first_name": parsed_data["first_name"],
                "last_name": parsed_data["last_name"],
                "city": parsed_data["city"],
                "state": parsed_data["state"],
                "linkedin": parsed_data["linkedin"],
                "github": parsed_data["github"],
                "email": parsed_data["email"],
                "phone": parsed_data["phone"],
                "skills": parsed_data["skills"],
                "education": parsed_data["education"],
                "experience": parsed_data["experience"],
                "projects": parsed_data["projects"],
                "leadership": parsed_data["leadership"],
                "experience_entries": parsed_data["experience_entries"],
                "project_entries": parsed_data["project_entries"],
                "leadership_entries": parsed_data["leadership_entries"],
            },
            "analysis": scored_data,
            "parser_source": parser_source,
            "applicant_profile": build_applicant_profile(parsed_data),
        }

    except HTTPException:
        raise
    except Exception:
        logger.exception("Resume processing failed for file %r", filename)
        raise HTTPException(
            status_code=500,
            detail="Resume processing failed. Please try again.",
        )
