import os
import unittest
from unittest.mock import Mock, patch


os.environ.setdefault("DB_HOST", "test.invalid")
os.environ.setdefault("DB_PORT", "3306")
os.environ.setdefault("DB_NAME", "testdb")
os.environ.setdefault("DB_USER", "testuser")
os.environ.setdefault("DB_PASSWORD", "testpassword")

from crawler import crawl  # noqa: E402
from database.queries import JobWriteResult  # noqa: E402


class CrawlerControlTests(unittest.TestCase):
    def test_dry_run_source_and_limit_skip_all_mutating_phases(self):
        found = [
            {
                "source": "linkedin",
                "source_job_id": str(index),
                "job_title": f"Job {index}",
                "company": "Example",
                "experience_level": "Internship",
            }
            for index in range(2)
        ]
        with (
            patch.object(crawl, "_log_db_target"),
            patch.object(crawl, "update_database") as cleanup,
            patch.object(crawl, "parse_job_linkedin", return_value=found) as linkedin,
            patch.object(crawl, "parse_job_handshake") as handshake,
            patch.object(crawl, "simplify_jobs"),
            patch.object(crawl, "extract_skills_for_jobs"),
            patch.object(crawl, "upsert_job", return_value=JobWriteResult("would_insert", reason="source_job_id")) as upsert,
            patch.object(crawl, "backfill_missing_summaries") as summaries,
            patch.object(crawl, "backfill_job_skills") as skills,
        ):
            crawl.run(dry_run=True, source="linkedin", limit=2)

        cleanup.assert_not_called()
        handshake.assert_not_called()
        linkedin.assert_called_once()
        self.assertEqual(linkedin.call_args.kwargs["max_jobs"], 2)
        self.assertEqual(upsert.call_count, 2)
        self.assertTrue(all(call.kwargs["dry_run"] for call in upsert.call_args_list))
        summaries.assert_not_called()
        skills.assert_not_called()

    def test_one_source_failure_does_not_stop_later_sources(self):
        found = [{
            "source": "linkedin", "source_job_id": "9",
            "application_link": "https://example.com/jobs/9",
            "job_title": "Software Engineer Intern", "company": "Example",
        }]
        with (
            patch.object(crawl, "source_urls", return_value=[("handshake", "h"), ("linkedin", "l")]),
            patch.object(crawl, "parse_job_handshake", side_effect=RuntimeError("source unavailable")),
            patch.object(crawl, "parse_job_linkedin", return_value=found),
        ):
            jobs, stats = crawl.collect_jobs(source="all", limit=2)

        self.assertEqual(len(jobs), 1)
        self.assertEqual(stats["source_errors"], 1)

    def test_collect_jobs_removes_same_canonical_url_across_sources(self):
        handshake = [{
            "source": "handshake", "source_job_id": "1",
            "application_link": "https://company.example/jobs/7?utm_source=handshake",
            "job_title": "Software Intern", "company": "Example",
        }]
        linkedin = [{
            "source": "linkedin", "source_job_id": "2",
            "application_link": "https://company.example/jobs/7",
            "job_title": "Software Intern", "company": "Example",
        }]
        with (
            patch.object(crawl, "source_urls", return_value=[("handshake", "h"), ("linkedin", "l")]),
            patch.object(crawl, "parse_job_handshake", return_value=handshake),
            patch.object(crawl, "parse_job_linkedin", return_value=linkedin),
        ):
            jobs, stats = crawl.collect_jobs(source="all", limit=3)

        self.assertEqual(len(jobs), 1)
        self.assertEqual(stats["duplicates"], 1)


if __name__ == "__main__":
    unittest.main()
