from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint

from database.connection import Base


class InterviewSession(Base):
    __tablename__ = "interview_sessions"
    __table_args__ = (
        Index("ix_interview_sessions_user_created", "user_id", "created_at"),
        Index("ix_interview_sessions_user_status", "user_id", "status"),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    job_id = Column(Integer, ForeignKey("job_data.id"), nullable=False)

    status = Column(String(40), nullable=False, default="in_progress")
    current_question_index = Column(Integer, nullable=False, default=0)
    total_questions = Column(Integer, nullable=False, default=0)
    processing_question_index = Column(Integer, nullable=True)
    processing_answer_hash = Column(String(64), nullable=True)
    processing_started_at = Column(DateTime, nullable=True)
    provider_call_count = Column(Integer, nullable=False, default=0)

    final_score = Column(Integer, nullable=True)
    overall_summary = Column(Text, nullable=True)

    job_snapshot = Column(Text, nullable=False)
    resume_snapshot = Column(Text, nullable=False)
    question_set = Column(Text, nullable=False)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class InterviewResponse(Base):
    __tablename__ = "interview_responses"
    __table_args__ = (
        UniqueConstraint("session_id", "question_id", name="uq_interview_response_question"),
        UniqueConstraint("session_id", "question_index", name="uq_interview_response_turn"),
        Index("ix_interview_responses_session_created", "session_id", "created_at"),
    )

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("interview_sessions.id"), nullable=False)

    question_id = Column(String(100), nullable=False)
    question_index = Column(Integer, nullable=False)
    question_prompt = Column(Text, nullable=False)

    answer_text = Column(Text, nullable=False)
    score = Column(Integer, nullable=False)
    benchmark = Column(String(40), nullable=False)
    feedback_json = Column(Text, nullable=False)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
