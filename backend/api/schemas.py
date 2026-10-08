from datetime import datetime
from typing import List, Optional, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


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


class InterviewResumeContext(BaseModel):
    # Unknown fields (including old clients' contact fields) are never persisted.
    model_config = ConfigDict(extra="ignore")
    skills: List[str] = Field(default_factory=list, max_length=50)
    education: List[str] = Field(default_factory=list, max_length=10)
    experience: List[str] = Field(default_factory=list, max_length=10)
    projects: List[str] = Field(default_factory=list, max_length=10)
    leadership: List[str] = Field(default_factory=list, max_length=10)
    experience_entries: List[StructuredResumeEntrySchema] = Field(default_factory=list, max_length=10)
    project_entries: List[StructuredResumeEntrySchema] = Field(default_factory=list, max_length=10)
    leadership_entries: List[StructuredResumeEntrySchema] = Field(default_factory=list, max_length=10)


class InterviewStartRequest(BaseModel):
    job_id: int = Field(gt=0, strict=True)
    resume_data: InterviewResumeContext
    mode: Literal["behavioral", "technical", "mixed", "role_specific"] = "mixed"
    question_count: Literal[3, 5, 8] = 5

    @field_validator("question_count", mode="before")
    @classmethod
    def strict_question_count(cls, value):
        if type(value) is not int:
            raise ValueError("Question count must be an integer.")
        return value


class InterviewQuestionOut(BaseModel):
    session_id: int
    question_index: int
    total_questions: int
    question_id: str
    focus_area: str
    prompt: str
    tips: List[str] = Field(default_factory=list)
    question_type: str = "mixed"
    source: Literal["ai", "fallback"] = "fallback"
    is_follow_up: bool = False
    parent_question_id: Optional[str] = None
    mode: str = "mixed"


class InterviewScoreDimension(BaseModel):
    label: str
    score: int = Field(ge=0, le=100)
    max_score: int = Field(gt=0, le=100)


class InterviewFeedbackOut(BaseModel):
    score: int = Field(ge=0, le=100)
    benchmark: str
    summary: str
    strengths: List[str] = Field(default_factory=list)
    improvements: List[str] = Field(default_factory=list)
    dimensions: List[InterviewScoreDimension] = Field(default_factory=list)
    source: Literal["ai", "fallback"] = "fallback"
    technical_depth: str = ""
    communication: str = ""
    role_relevance: str = ""
    evidence: List[str] = Field(default_factory=list)
    suggested_approach: str = ""
    follow_up: Optional[str] = None


class InterviewResponseReference(BaseModel):
    question: str
    answer_excerpt: str
    score: int = Field(ge=0, le=100)


class FinalInterviewResultOut(BaseModel):
    final_score: int = Field(ge=0, le=100)
    overall_summary: str
    top_strengths: List[str] = Field(default_factory=list)
    next_steps: List[str] = Field(default_factory=list)
    dimensions: List[InterviewScoreDimension] = Field(default_factory=list)
    source: Literal["ai", "fallback"] = "fallback"
    technical_signals: str = ""
    communication_signals: str = ""
    resume_evidence: List[str] = Field(default_factory=list)
    strongest_questions: List[str] = Field(default_factory=list)
    practice_questions: List[str] = Field(default_factory=list)
    strongest_responses: List[InterviewResponseReference] = Field(default_factory=list)
    weakest_responses: List[InterviewResponseReference] = Field(default_factory=list)
    specificity_needs: List[str] = Field(default_factory=list)


class InterviewAnswerRequest(BaseModel):
    answer: str = Field(min_length=1, max_length=5000)
    question_id: str = Field(min_length=1, max_length=100)


    @field_validator("answer")
    @classmethod
    def non_blank_answer(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Answer must contain text.")
        return value.strip()


class InterviewAnswerResponse(BaseModel):
    session_id: int
    question_index: int
    is_complete: bool
    feedback: InterviewFeedbackOut
    next_question: Optional[InterviewQuestionOut] = None
    final_result: Optional[FinalInterviewResultOut] = None


class InterviewSessionOut(BaseModel):
    session_id: int
    job_id: int
    status: Literal["in_progress", "completed"]
    mode: str
    total_questions: int
    current_question: Optional[InterviewQuestionOut] = None
    last_response: Optional[InterviewAnswerResponse] = None
