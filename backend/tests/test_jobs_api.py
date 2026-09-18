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


class JobsApiTests(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
