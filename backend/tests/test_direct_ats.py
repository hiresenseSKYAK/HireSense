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

    def test_greenhouse_office_job_mentioning_remote_in_description_is_not_remote(self):
        job = _normalize_greenhouse_job({
            "id": 8,
            "title": "Software Engineer Intern",
            "company_name": "Example",
            "content": DESCRIPTION + " We support remote work for some teams and offer work from home days.",
            "location": {"name": "Dallas, TX"},
            "absolute_url": "https://boards.greenhouse.io/example/jobs/8",
        }, "Example")
        self.assertIsNotNone(job)
        self.assertEqual(job["work_style"], "On-site")
        self.assertEqual(job["location"], "Dallas, TX")

    def test_ashby_hybrid_role_flagged_is_remote_stays_hybrid(self):
        # Ramp's feed: workplaceType Hybrid in New York, yet isRemote is true.
        job = _normalize_ashby_job({
            "id": "ramp-1",
            "title": "Risk Strategy Intern",
            "descriptionPlain": DESCRIPTION,
            "location": "New York, NY (HQ)",
            "isRemote": True,
            "workplaceType": "Hybrid",
            "address": {"postalAddress": {"addressLocality": "New York City", "addressRegion": "NY", "addressCountry": "USA"}},
            "secondaryLocations": [],
            "applyUrl": "https://jobs.ashbyhq.com/ramp/ramp-1/application",
        }, "Ramp")
        self.assertIsNotNone(job)
        self.assertEqual(job["work_style"], "Hybrid")
        self.assertNotIn("Remote", job["location"])

    def test_feed_is_complete_only_when_every_listing_was_examined(self):
        from unittest.mock import MagicMock, patch
        from crawler.parsers.ats import parse_direct_ats

        listings = [{"id": i, "title": "Software Engineer Intern", "content": DESCRIPTION,
                     "location": {"name": "Dallas, TX"},
                     "absolute_url": f"https://boards.greenhouse.io/example/jobs/{i}"} for i in range(5)]
        response = MagicMock(status_code=200, text="<html></html>")
        response.json.return_value = {"jobs": listings}
        session = MagicMock()
        session.__enter__.return_value = session
        session.get.return_value = response
        with patch("crawler.parsers.ats.requests.Session", return_value=session):
            full, partial = {}, {}
            parse_direct_ats("https://feed", provider="greenhouse", company="Example", max_jobs=50, stats=full)
            parse_direct_ats("https://feed", provider="greenhouse", company="Example", max_jobs=2, stats=partial)
        self.assertEqual(full["complete"], 1)
        self.assertEqual(partial["complete"], 0)


if __name__ == "__main__":
    unittest.main()
