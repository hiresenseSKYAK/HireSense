import unittest

from crawler.parsers.ats import (
    _normalize_ashby_job,
    _normalize_greenhouse_job,
    _normalize_lever_job,
)


DESCRIPTION = "Build production Python software and REST API services. 0-2 years of professional experience."


class DirectAtsAdapterTests(unittest.TestCase):
    def test_greenhouse_maps_direct_apply_freshness_and_logo(self):
        job = _normalize_greenhouse_job({
            "id": 7,
            "title": "Software Engineer - New Grad",
            "company_name": "Example",
            "content": DESCRIPTION,
            "location": {"name": "Remote - US"},
            "first_published": "2026-09-20T12:00:00Z",
            "absolute_url": "https://boards.greenhouse.io/example/jobs/7",
            "company_logo_url": "https://example.com/logo.png",
        }, "Example")
        self.assertIsNotNone(job)
        self.assertEqual(job["source"], "greenhouse")
        self.assertEqual(job["date_posted"], "2026-09-20")
        self.assertEqual(job["work_style"], "Remote")
        self.assertEqual(job["company_logo_url"], "https://example.com/logo.png")

    def test_lever_maps_dallas_early_career_role(self):
        job = _normalize_lever_job({
            "id": "abc",
            "text": "Junior Data Engineer",
            "descriptionPlain": DESCRIPTION,
            "categories": {"location": "Dallas, TX", "commitment": "Full-time"},
            "createdAt": 1_758_326_400_000,
            "applyUrl": "https://jobs.lever.co/example/abc/apply",
            "salaryRange": {"min": 70_000, "max": 90_000},
        }, "Example")
        self.assertIsNotNone(job)
        self.assertEqual(job["location"], "Dallas, TX")
        self.assertEqual(job["salary"], 80_000)

    def test_ashby_uses_explicit_us_remote_secondary_location(self):
        job = _normalize_ashby_job({
            "id": "ashby-id",
            "title": "Software Engineer, Early Career",
            "descriptionPlain": DESCRIPTION,
            "location": "London, UK",
            "isListed": True,
            "isRemote": True,
            "workplaceType": "Remote",
            "secondaryLocations": [{
                "location": "Remote (US)",
                "address": {"postalAddress": {"addressCountry": "United States"}},
            }],
            "publishedAt": "2026-09-21T09:30:00-05:00",
            "applyUrl": "https://jobs.ashbyhq.com/example/ashby-id/application",
            "employmentType": "FullTime",
        }, "Example")
        self.assertIsNotNone(job)
        self.assertEqual(job["location"], "Remote — United States")
        self.assertEqual(job["work_style"], "Remote")

    def test_ashby_rejects_foreign_only_remote(self):
        job = _normalize_ashby_job({
            "id": "foreign",
            "title": "Software Engineer, Early Career",
            "descriptionPlain": DESCRIPTION,
            "location": "Remote (Canada)",
            "isListed": True,
            "isRemote": True,
            "workplaceType": "Remote",
            "secondaryLocations": [{
                "location": "Remote (Canada)",
                "address": {"postalAddress": {"addressCountry": "Canada"}},
            }],
            "applyUrl": "https://jobs.ashbyhq.com/example/foreign/application",
        }, "Example")
        self.assertIsNone(job)


if __name__ == "__main__":
    unittest.main()
