from collections import Counter
import logging
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query

try:
    from backend.database.queries import (
        fetch_all_jobs_from_db,
        fetch_job_by_id_from_db,
    )
except ImportError:
    try:
        from database.queries import (
            fetch_all_jobs_from_db,
            fetch_job_by_id_from_db,
        )
    except ImportError:
        fetch_all_jobs_from_db = None
        fetch_job_by_id_from_db = None

try:
    from services.job_listing import assemble_job_page
except ImportError:
    from backend.services.job_listing import assemble_job_page

router = APIRouter(prefix="/jobs", tags=["jobs"])
logger = logging.getLogger(__name__)


def get_jobs_data():
    if fetch_all_jobs_from_db is None:
        logger.error("Jobs database query module is unavailable")
        raise HTTPException(status_code=503, detail="Job service temporarily unavailable")
    try:
        return fetch_all_jobs_from_db()
    except Exception:
        logger.exception("Failed to read jobs from the database")
        raise HTTPException(status_code=503, detail="Job service temporarily unavailable")


@router.get("/market-insights")
def get_market_insights():
    jobs = get_jobs_data()

    skill_counter = Counter()
    location_counter = Counter()
    company_counter = Counter()

    for job in jobs:
        for tag in job.get("tags", []):
            skill_counter[tag] += 1

        location = job.get("location", "Unknown")
        location_counter[location] += 1

        company = job.get("company", "Unknown")
        company_counter[company] += 1

    total_jobs = len(jobs)
    remote_jobs = sum(1 for job in jobs if job.get("hybrid") == "Remote")
    hybrid_jobs = sum(1 for job in jobs if job.get("hybrid") == "Hybrid")
    onsite_jobs = sum(1 for job in jobs if job.get("hybrid") == "On-site")

    return {
        "overview": {
            "total_jobs": total_jobs,
            "remote_jobs": remote_jobs,
            "hybrid_jobs": hybrid_jobs,
            "onsite_jobs": onsite_jobs,
        },
        "trending_skills": [
            {"name": name, "count": count}
            for name, count in skill_counter.most_common(6)
        ],
        "top_locations": [
            {"city": city, "count": count}
            for city, count in location_counter.most_common(5)
        ],
        "top_companies": [
            {"name": name, "count": count}
            for name, count in company_counter.most_common(5)
        ],
    }


def _query_values(values: list[str] | None) -> list[str]:
    return [value.strip() for value in (values or []) if value and value.strip()]


@router.get("/")
def get_jobs(
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=50)] = 20,
    q: str = "",
    city: Annotated[list[str] | None, Query()] = None,
    style: Annotated[list[str] | None, Query()] = None,
    experience: Annotated[list[str] | None, Query()] = None,
    salary: Annotated[list[str] | None, Query()] = None,
    job_type: Annotated[list[str] | None, Query(alias="type")] = None,
    date: Annotated[list[str] | None, Query()] = None,
    skill: Annotated[list[str] | None, Query()] = None,
    sort: str = "recently-discovered",
):
    return assemble_job_page(
        get_jobs_data(),
        page=page,
        page_size=page_size,
        q=q,
        cities=_query_values(city),
        styles=_query_values(style),
        experience=_query_values(experience),
        salaries=_query_values(salary),
        job_types=_query_values(job_type),
        dates=_query_values(date),
        skills=_query_values(skill),
        sort=sort,
    )


@router.get("/{job_id}")
def get_job_by_id(job_id: int):
    if fetch_job_by_id_from_db is None:
        logger.error("Jobs database query module is unavailable")
        raise HTTPException(status_code=503, detail="Job service temporarily unavailable")
    try:
        job = fetch_job_by_id_from_db(job_id)
    except Exception:
        logger.exception("Failed to read job id=%s from the database", job_id)
        raise HTTPException(status_code=503, detail="Job service temporarily unavailable")
    if job:
        return job

    raise HTTPException(status_code=404, detail="Job not found")
