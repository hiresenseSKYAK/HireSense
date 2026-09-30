import os
import unittest
from datetime import datetime

os.environ.setdefault("DB_HOST", "test.invalid")
os.environ.setdefault("DB_PORT", "3306")
os.environ.setdefault("DB_NAME", "testdb")
os.environ.setdefault("DB_USER", "testuser")
os.environ.setdefault("DB_PASSWORD", "testpassword")

from services.job_listing import assemble_job_page


def job(**overrides):
    base = {
        "id": 1,
        "title": "Software Engineer Intern",
        "company": "Alpha",
        "location": "Dallas, TX",
        "type": "Internship",
        "salary": "Not listed",
        "tags": ["Python"],
        "posted": "2026-09-20",
        "datePosted": "2026-09-20",
        "firstSeenAt": "2026-09-25T10:00:00",
        "hybrid": "On-site",
        "experienceLevel": "Internship",
        "description": "Short summary",
        "fullDescription": "A" * 800,
    }
    base.update(overrides)
    return base


class JobListingTests(unittest.TestCase):
    def test_pages_after_search_and_keeps_the_full_city_list(self):
        catalog = [
            job(id=1, title="Data Intern", company="Zeta", location="Plano, TX", firstSeenAt="2026-09-26T10:00:00"),
            job(id=2, title="Data Intern", company="Beta", location="Dallas, TX", firstSeenAt="2026-09-25T10:00:00"),
            job(id=3, title="Designer", company="Gamma", location="Austin, TX", firstSeenAt="2026-09-24T10:00:00"),
        ]

        page = assemble_job_page(catalog, q="data", page=1, page_size=1, sort="recently-discovered")

        self.assertEqual(page["total"], 2)
        self.assertEqual(page["items"][0]["id"], 1)
        self.assertEqual(page["cities"], ["Austin", "Dallas", "Plano"])
        self.assertNotIn("fullDescription", page["items"][0])
        self.assertEqual(page["items"][0]["description"], "Short summary")

        long_card = assemble_job_page([job(description="B" * 600, fullDescription="C" * 900)])
        self.assertTrue(long_card["items"][0]["description"].endswith("\u2026"))
        self.assertLess(len(long_card["items"][0]["description"]), 600)

        second = assemble_job_page(catalog, q="data", page=2, page_size=1, sort="recently-discovered")
        self.assertEqual(second["items"][0]["id"], 2)

    def test_best_match_ranks_before_the_page_is_cut(self):
        catalog = [
            job(id=1, tags=["Java"], title="Java Intern"),
            job(id=2, tags=["Python", "SQL", "Git", "Docker"], title="Platform Intern"),
            job(id=3, tags=["Python"], title="Python Intern"),
        ]

        page = assemble_job_page(catalog, skills=["Python"], sort="best-match", page_size=1)

        self.assertEqual(page["items"][0]["title"], "Python Intern")
        self.assertGreater(page["items"][0]["match"], 0)
        self.assertEqual(page["match_summary"]["scored"], 3)
        self.assertEqual(page["total"], 3)

    def test_salary_filter_uses_the_same_buckets_as_the_page(self):
        catalog = [
            job(id=1, salary=80000, salaryRange=80000),
            job(id=2, salary=20000, salaryRange=20000),
        ]
        page = assemble_job_page(catalog, salaries=["$60k \u2013 $90k"])
        self.assertEqual([item["id"] for item in page["items"]], [1])

    def test_date_filter_drops_older_postings(self):
        catalog = [
            job(id=1, datePosted="2026-09-28", posted="2026-09-28"),
            job(id=2, datePosted="2026-08-01", posted="2026-08-01"),
        ]
        page = assemble_job_page(catalog, dates=["Last 7 days"], now=datetime(2026, 9, 30, 12, 0, 0))
        self.assertEqual([item["id"] for item in page["items"]], [1])


if __name__ == "__main__":
    unittest.main()
