"""Authenticated, bounded AI coaching endpoints with deterministic degradation."""
import json
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from api.interview import _job_snapshot, _resolve_user_id
from api.schemas import InterviewResumeContext
from database.connection import get_db
from database.models import Job
from services.career_ai import CareerAIService
from services.job_location import assess_job_geography

router = APIRouter(prefix='/ai', tags=['career-coaching'])


class CareerCoachRequest(BaseModel):
    resume_data: InterviewResumeContext


def _service(request: Request) -> CareerAIService:
    return request.app.state.career_ai_service


def _bounded_resume(body: CareerCoachRequest) -> dict:
    payload = body.resume_data.model_dump()
    if len(json.dumps(payload).encode('utf-8')) > 32000:
        raise HTTPException(422, 'Resume context is too long. Shorten the extracted resume before coaching.')
    return payload


@router.post('/resume-coach')
def resume_coach(
    body: CareerCoachRequest,
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
    service: CareerAIService = Depends(_service),
):
    user_id = _resolve_user_id(db, authorization)
    return service.resume_coach(user_id, _bounded_resume(body))


@router.post('/jobs/{job_id}/preparation')
def job_preparation(
    job_id: int,
    body: CareerCoachRequest,
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
    service: CareerAIService = Depends(_service),
):
    user_id = _resolve_user_id(db, authorization)
    job = db.query(Job).filter(Job.id == job_id, Job.active.is_(True)).first()
    if not job or not assess_job_geography(job.location, job.work_style, job.job_description).accepted:
        raise HTTPException(404, 'This job is unavailable for personalized preparation.')
    snapshot = _job_snapshot(job)
    authoritative = {
        'title': snapshot['job_title'], 'company': snapshot['company'],
        'description': snapshot['job_description'], 'skills': snapshot['skills'],
    }
    db.rollback()
    return service.job_preparation(user_id, authoritative, _bounded_resume(body))
