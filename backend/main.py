import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import database.models  # noqa: F401
from api.interview import router as interview_router
from api.jobs import router as jobs_router
from api.resume import router as resume_router
from api.routers import auth
from database.connection import Base, engine
from database.queries import ensure_job_description_summary_column
from services.interview_provider import build_openai_interview_provider
from services.interview_settings import get_interview_ai_settings

app = FastAPI(title="HireSense API")
app.state.interview_provider = build_openai_interview_provider(get_interview_ai_settings())

Base.metadata.create_all(bind=engine)
ensure_job_description_summary_column()

allowed_origins = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(jobs_router)
app.include_router(resume_router)
app.include_router(auth.router)
app.include_router(interview_router)


@app.get("/")
def read_root():
    return {"message": "HireSense backend is running"}


@app.get("/health")
def health_check():
    return {"status": "ok"}
