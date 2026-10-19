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
from database.models import InterviewResponse, InterviewSession
from services.career_ai import CareerAIService
from services.job_intelligence import coaching_signals_from_feedback
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


@router.post('/jobs/recommendations')
def job_recommendations(
    body: CareerCoachRequest,
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
    service: CareerAIService = Depends(_service),
):
    user_id = _resolve_user_id(db, authorization)
    feedback_rows = db.query(InterviewResponse.feedback_json).join(
        InterviewSession, InterviewResponse.session_id == InterviewSession.id,
    ).filter(
        InterviewSession.user_id == user_id, InterviewSession.status == 'completed',
    ).order_by(InterviewResponse.created_at.desc()).limit(30).all()
    feedback = []
    for row in feedback_rows:
        try:
            parsed = json.loads(row[0])
            if isinstance(parsed, dict):
                feedback.append(parsed)
        except (TypeError, ValueError):
            continue
    signals = coaching_signals_from_feedback(feedback)
    db.rollback()
    from api.jobs import get_jobs_data
    return service.recommendations(user_id, get_jobs_data(), _bounded_resume(body), signals)
