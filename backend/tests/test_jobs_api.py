import os
import unittest
from unittest.mock import patch

os.environ.setdefault("DB_HOST", "test.invalid")
os.environ.setdefault("DB_PORT", "3306")
os.environ.setdefault("DB_NAME", "testdb")
os.environ.setdefault("DB_USER", "testuser")
os.environ.setdefault("DB_PASSWORD", "testpassword")

from fastapi import HTTPException

from api import jobs
from database.queries import _eligible_unique_rows, _map_db_row_to_frontend_job


class JobsApiTests(unittest.TestCase):
    def test_api_keeps_source_posted_and_first_seen_separate(self):
        result = _map_db_row_to_frontend_job({
            "id": 1,
            "job_title": "Software Engineer Intern",
            "company": "Example",
            "date_posted": None,
            "first_seen_at": "2026-09-25 12:00:00",
            "company_logo_url": "https://example.com/logo.png",
            "source": "greenhouse",
        })
        self.assertIsNone(result["datePosted"])
        self.assertEqual(result["firstSeenAt"], "2026-09-25 12:00:00")
        self.assertIsNone(result["badge"])
        self.assertEqual(result["companyLogoUrl"], "https://example.com/logo.png")

    def test_empty_database_returns_honest_empty_list(self):
        with patch.object(jobs, "fetch_all_jobs_from_db", return_value=[]):
            self.assertEqual(jobs.get_jobs(), [])

    def test_database_failure_returns_503(self):
        with patch.object(jobs, "fetch_all_jobs_from_db", side_effect=RuntimeError("offline")):
            with self.assertRaises(HTTPException) as raised:
                jobs.get_jobs()
        self.assertEqual(raised.exception.status_code, 503)

    def test_unknown_database_job_returns_404(self):
        with patch.object(jobs, "fetch_job_by_id_from_db", return_value=None):
            with self.assertRaises(HTTPException) as raised:
                jobs.get_job_by_id(999)
        self.assertEqual(raised.exception.status_code, 404)

    def test_market_insights_use_database_jobs(self):
        real_jobs = [
            {
                "tags": ["Python"],
                "location": "Dallas, TX",
                "company": "Real Company",
                "hybrid": "Remote",
            }
        ]
        with patch.object(jobs, "fetch_all_jobs_from_db", return_value=real_jobs):
            result = jobs.get_market_insights()
        self.assertEqual(result["overview"]["total_jobs"], 1)
        self.assertEqual(result["top_companies"][0]["name"], "Real Company")

    def test_read_guard_excludes_legacy_geography_and_exact_duplicates(self):
        base = {
            "job_title": "Software Engineer Intern",
            "company": "Example",
            "location": "Dallas, TX",
            "work_style": "On-site",
            "job_description": "Build the same software product.",
            "application_link": "https://example.com/jobs/1",
        }
        rows = [
            {**base, "id": 4, "canonical_url": "https://example.com/jobs/4"},
            {**base, "id": 3, "canonical_url": "https://example.com/jobs/3"},
            {**base, "id": 2, "location": "New York, NY", "canonical_url": "https://example.com/jobs/2"},
            {**base, "id": 1, "company": "Toyota Automated Logistics", "location": "Grapevine, TX", "canonical_url": "https://example.com/jobs/toyota", "job_description": "The intern will work with the R&D team in Indianapolis, IN."},
        ]

        result = _eligible_unique_rows(rows)
        self.assertEqual([row["id"] for row in result], [4])


if __name__ == "__main__":
    unittest.main()
