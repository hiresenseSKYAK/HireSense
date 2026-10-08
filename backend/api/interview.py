import json
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlalchemy.orm import Session

from api.schemas import InterviewAnswerRequest, InterviewAnswerResponse, InterviewQuestionOut, InterviewStartRequest, InterviewSessionOut
from database.connection import get_db
from database.models import InterviewResponse, InterviewSession, Job, UserSession
from services.interview_engine import InterviewEngine, interview_context, questions_overlap
from services.interview_context import safe_resume_context, safe_text
from services.interview_service import _description_text, _extract_job_skills
from services.job_location import assess_job_geography

router = APIRouter(prefix='/interview', tags=['interview'])
SESSION_LIFETIME = timedelta(hours=24)


def get_interview_engine(request: Request) -> InterviewEngine:
    # Shared provider is injected once by application startup, not configured by clients.
    return InterviewEngine(getattr(request.app.state, 'interview_provider', None))


def _resolve_user_id(db: Session, authorization: Optional[str]) -> int:
    if authorization is None:
        raise HTTPException(401, 'Sign in to start or continue an interview.')
    if not authorization.lower().startswith('bearer '):
        raise HTTPException(401, 'Sign in again to continue.')
    token = authorization[7:].strip()
    user_session = db.query(UserSession).filter(
        UserSession.token == token, UserSession.expires_at > datetime.utcnow(),
    ).first()
    if not user_session:
        raise HTTPException(401, 'Sign in again to continue.')
    return user_session.user_id


def _job_snapshot(job: Job) -> dict:
    payload = {key: safe_text(getattr(job, key), 500) for key in (
        'job_title', 'company', 'location', 'job_type', 'experience_level', 'work_style')}
    payload['id'] = job.id
    payload['job_description'] = safe_text(_description_text({'job_description': job.job_description}), 12000)
    payload['skills'] = [safe_text(s, 100) for s in _extract_job_skills({'skills': job.skills})[:50]]
    # JSON escaping can enlarge Unicode descriptions beyond MySQL TEXT capacity.
    while len(json.dumps(payload).encode('utf-8')) > 56000:
        if payload['job_description']:
            payload['job_description'] = payload['job_description'][:len(payload['job_description']) // 2]
        else:
            payload['skills'].pop()
    return payload


def _question_out(session, question, index):
    return InterviewQuestionOut(
        session_id=session.id, question_index=index + 1,
        total_questions=session.total_questions,
        **{key: question[key] for key in ('question_id', 'focus_area', 'prompt', 'tips',
                                          'question_type', 'source', 'is_follow_up', 'mode')},
        parent_question_id=question.get('parent_question_id'),
    )


def _authorize(session, user_id):
    if session.user_id is None or session.user_id != user_id:
        raise HTTPException(404, 'Interview session not found.')
    metadata = json.loads(session.resume_snapshot).get('_interview', {})
    if metadata.get('version') != 2:
        raise HTTPException(410, 'Start a new interview to use the updated session flow.')
    if session.created_at + SESSION_LIFETIME <= datetime.utcnow():
        raise HTTPException(410, 'This interview expired. Start a new interview.')


def _owned_session(db, session_id, user_id):
    session = db.query(InterviewSession).filter(InterviewSession.id == session_id).first()
    if not session:
        raise HTTPException(404, 'Interview session not found.')
    _authorize(session, user_id)
    return session


@router.post('/start', response_model=InterviewQuestionOut)
def start_interview(
    body: InterviewStartRequest,
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
    engine: InterviewEngine = Depends(get_interview_engine),
):
    user_id = _resolve_user_id(db, authorization)
    job = db.query(Job).filter(Job.id == body.job_id, Job.active.is_(True),
                               Job.experience_level.in_(['Internship', 'Entry level'])).first()
    if not job or not assess_job_geography(job.location, job.work_style, job.job_description).accepted:
        raise HTTPException(404, 'This job is unavailable for interview practice.')
    professional_payload = body.resume_data.model_dump()
    if len(json.dumps(professional_payload).encode('utf-8')) > 32000:
        raise HTTPException(422, 'Resume context is too long. Shorten the extracted resume before starting.')
    resume = safe_resume_context(professional_payload)
    if len(json.dumps(resume).encode('utf-8')) > 32000:
        raise HTTPException(422, 'Resume context is too long. Shorten the extracted resume before starting.')
    if not any(resume.get(k) for k in ('skills', 'experience_entries', 'project_entries', 'education', 'experience', 'projects')):
        raise HTTPException(422, 'Add resume skills, education, or experience before starting.')
    job_data = _job_snapshot(job)
    questions = engine.questions(job_data, resume, body.mode, body.question_count)
    # Store versioned session metadata in existing JSON, avoiding a production migration.
    resume['_interview'] = {'version': 2, 'mode': body.mode, 'base_count': body.question_count,
                            'count_semantics': 'total_turns'}
    session = InterviewSession(
        user_id=user_id, job_id=job.id, status='in_progress', current_question_index=0,
        total_questions=len(questions), job_snapshot=json.dumps(job_data),
        resume_snapshot=json.dumps(resume), question_set=json.dumps(questions),
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return _question_out(session, questions[0], 0)


@router.post('/{session_id}/answer', response_model=InterviewAnswerResponse)
def answer_interview_question(
    session_id: int,
    body: InterviewAnswerRequest,
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
    engine: InterviewEngine = Depends(get_interview_engine),
):
    user_id = _resolve_user_id(db, authorization)
    session = _owned_session(db, session_id, user_id)
    previous = db.query(InterviewResponse).filter(
        InterviewResponse.session_id == session.id, InterviewResponse.question_id == body.question_id,
    ).first()
    if previous:
        cached = json.loads(previous.feedback_json).get('_response')
        if previous.answer_text == body.answer and cached:
            return InterviewAnswerResponse(**cached)
        raise HTTPException(409, 'This question already has an answer.')
    if session.status != 'in_progress':
        raise HTTPException(409, 'This interview is already completed.')
    questions = json.loads(session.question_set)
    index = session.current_question_index
    if index >= len(questions) or questions[index]['question_id'] != body.question_id:
        raise HTTPException(409, 'This question is no longer current.')
    # Compare-and-swap acquires a write lock before evaluation. Concurrent requests
    # cannot record duplicate responses or skip questions. All changes commit together.
    claimed = db.query(InterviewSession).filter(
        InterviewSession.id == session.id, InterviewSession.current_question_index == index,
        InterviewSession.status == 'in_progress',
    ).update({'current_question_index': index + 1}, synchronize_session=False)
    if claimed != 1:
        db.rollback()
        raise HTTPException(409, 'Another answer is being processed. Retry this answer.')
    try:
        resume = json.loads(session.resume_snapshot)
        metadata = resume.get('_interview', {})
        context = interview_context(json.loads(session.job_snapshot), resume,
                                    metadata.get('mode', 'mixed'), metadata.get('base_count', len(questions)))
        saved = db.query(InterviewResponse).filter(InterviewResponse.session_id == session.id).order_by(InterviewResponse.question_index).all()
        history = [dict(question_prompt=r.question_prompt, answer=r.answer_text, score=r.score,
                        feedback={k: v for k, v in json.loads(r.feedback_json).items() if k != '_response'}) for r in saved]
        question = questions[index]
        feedback = engine.feedback(context, question, body.answer, history)
        # Follow-ups consume a selected turn and leave at least one planned turn.
        # Never chain follow-ups or repeat a prompt already planned/asked.
        probe = feedback.get('follow_up')
        maximum = min(2, max(1, len(questions) // 3))
        if (probe and not question.get('is_follow_up') and index < len(questions) - 2
                and sum(q.get('is_follow_up', False) for q in questions) < maximum
                and not any(questions_overlap(probe, q['prompt']) for q in questions)):
            questions[index + 1] = dict(question, question_id=f"{question['question_id']}-followup",
                                        parent_question_id=question['question_id'], prompt=probe,
                                        is_follow_up=True, source=feedback['source'],
                                        tips=['Build on your previous answer with a concrete detail.'])
        else:
            feedback['follow_up'] = None
        session.question_set = json.dumps(questions)
        session.total_questions = len(questions)
        session.current_question_index = index + 1
        complete = index + 1 == len(questions)
        final = None
        if complete:
            final = engine.final(context, history + [dict(question_prompt=question['prompt'], answer=body.answer, score=feedback['score'], feedback=feedback)])
            session.status = 'completed'
            session.final_score = final['final_score']
            session.overall_summary = final['overall_summary']
        result = InterviewAnswerResponse(
            session_id=session.id, question_index=index + 1, is_complete=complete,
            feedback=feedback, final_result=final,
            next_question=None if complete else _question_out(session, questions[index + 1], index + 1),
        )
        db.add(InterviewResponse(session_id=session.id, question_id=question['question_id'], question_index=index,
                                 question_prompt=question['prompt'], answer_text=body.answer, score=feedback['score'],
                                 benchmark=feedback['benchmark'], feedback_json=json.dumps(dict(feedback, _response=result.model_dump()))))
        db.commit()
        return result
    except Exception:
        db.rollback()
        raise


@router.get('/{session_id}', response_model=InterviewSessionOut)
def get_interview_session(
    session_id: int,
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
):
    user_id = _resolve_user_id(db, authorization)
    session = _owned_session(db, session_id, user_id)
    questions = json.loads(session.question_set)
    latest = db.query(InterviewResponse).filter(InterviewResponse.session_id == session.id).order_by(InterviewResponse.question_index.desc()).first()
    cached = json.loads(latest.feedback_json).get('_response') if latest else None
    metadata = json.loads(session.resume_snapshot)['_interview']
    return InterviewSessionOut(
        session_id=session.id, job_id=session.job_id, status=session.status,
        mode=metadata['mode'], total_questions=session.total_questions,
        current_question=None if session.status == 'completed' else _question_out(session, questions[session.current_question_index], session.current_question_index),
        last_response=cached,
    )
