from sqlalchemy import Boolean, Column, Date, DateTime, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import relationship

from database.connection import Base


class Job(Base):
    __tablename__ = "job_data"

    __table_args__ = (
        UniqueConstraint("identity_key", name="uq_job_data_identity_key"),
        UniqueConstraint("source", "source_job_id", name="uq_job_data_source_job"),
    )

    id = Column(Integer, primary_key=True)
    source = Column(String(32), nullable=True)
    source_job_id = Column(String(191), nullable=True)
    job_title = Column(String(255), nullable=False)
    company = Column(String(255), nullable=True)
    location = Column(String(255), nullable=True)
    salary = Column(Integer, nullable=True)
    date_posted = Column(Date, nullable=True)
    application_link = Column(String(1000), nullable=True)
    canonical_url = Column(String(1000), nullable=True)
    identity_key = Column(String(64), nullable=True)
    first_seen_at = Column(DateTime, nullable=False, server_default=func.now())
    last_seen_at = Column(DateTime, nullable=False, server_default=func.now())
    last_checked_at = Column(DateTime, nullable=True)
    active = Column(Boolean, nullable=False, server_default="1")
    job_description = Column(Text, nullable=True)
    job_description_summary = Column(Text, nullable=True)
    skills = Column(Text, nullable=True)
    job_type = Column(String(100), nullable=True, default="Full-time")
    experience_level = Column(String(100), nullable=True)
    work_style = Column(String(100), nullable=True, default="On-site")

    saved_by = relationship("SavedJob", back_populates="job", cascade="all, delete")
    applied_by = relationship("AppliedJob", back_populates="job", cascade="all, delete")
