from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, EmailStr, Field


class UserCreate(BaseModel):
    username: str
    email: EmailStr
    password: str


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    id: int
    username: str
    email: str
    joined_at: datetime

    class Config:
        from_attributes = True


class AuthResponse(BaseModel):
    token: str
    user: UserOut


# Aliases expected by auth.py
SignupRequest = UserCreate
LoginRequest = UserLogin


class EducationProfileSchema(BaseModel):
    school: str = ""
    degree: str = ""
    fieldOfStudy: str = ""
    startDate: str = ""
    endDate: str = ""
    current: bool = False


class ExperienceProfileSchema(BaseModel):
    company: str = ""
    title: str = ""
    location: str = ""
    startDate: str = ""
    endDate: str = ""
    description: str = ""
    current: bool = False


class ApplicantProfileSchema(BaseModel):
    skills: List[str] = Field(default_factory=list)
    education: List[EducationProfileSchema] = Field(default_factory=list)
    experience: List[ExperienceProfileSchema] = Field(default_factory=list)


class StructuredResumeEntrySchema(BaseModel):
    title: str
    bullets: List[str] = Field(default_factory=list)


class ParsedResumeDataSchema(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    skills: List[str] = Field(default_factory=list)
    education: List[str] = Field(default_factory=list)
    experience: List[str] = Field(default_factory=list)
    projects: List[str] = Field(default_factory=list)
    leadership: List[str] = Field(default_factory=list)
    experience_entries: List[StructuredResumeEntrySchema] = Field(default_factory=list)
    project_entries: List[StructuredResumeEntrySchema] = Field(default_factory=list)
    leadership_entries: List[StructuredResumeEntrySchema] = Field(default_factory=list)


class InterviewStartRequest(BaseModel):
    job_id: int
    resume_data: ParsedResumeDataSchema


class InterviewQuestionOut(BaseModel):
    session_id: int
    question_index: int
    total_questions: int
    question_id: str
    focus_area: str
    prompt: str
    tips: List[str] = Field(default_factory=list)


class InterviewFeedbackOut(BaseModel):
    score: int
    benchmark: str
    summary: str
    strengths: List[str] = Field(default_factory=list)
    improvements: List[str] = Field(default_factory=list)


class FinalInterviewResultOut(BaseModel):
    final_score: int
    overall_summary: str
    top_strengths: List[str] = Field(default_factory=list)
    next_steps: List[str] = Field(default_factory=list)


class InterviewAnswerRequest(BaseModel):
    answer: str = Field(min_length=1, max_length=5000)


class InterviewAnswerResponse(BaseModel):
    session_id: int
    question_index: int
    is_complete: bool
    feedback: InterviewFeedbackOut
    next_question: Optional[InterviewQuestionOut] = None
    final_result: Optional[FinalInterviewResultOut] = None