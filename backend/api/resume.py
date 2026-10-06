import logging

from fastapi import APIRouter, File, HTTPException, UploadFile
from services.applicant_profile import build_applicant_profile
from services.file_extractor import extract_resume_text
from services.resume_parser import parse_resume_text
from services.resume_scorer import score_resume

router = APIRouter(prefix="/resume", tags=["resume"])
logger = logging.getLogger(__name__)

ALLOWED_EXTENSIONS = (".pdf", ".docx")
MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024


@router.post("/upload")
async def upload_resume(file: UploadFile = File(...)):
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

        parsed_data = parse_resume_text(extracted_text)
        scored_data = score_resume(parsed_data)

        return {
            "filename": filename,
            "parsed_data": {
                "name": parsed_data["name"],
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
