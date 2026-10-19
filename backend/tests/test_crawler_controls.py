import os
import sys
import unittest
from unittest.mock import Mock, patch


os.environ.setdefault("DB_HOST", "test.invalid")
os.environ.setdefault("DB_PORT", "3306")
os.environ.setdefault("DB_NAME", "testdb")
os.environ.setdefault("DB_USER", "testuser")
os.environ.setdefault("DB_PASSWORD", "testpassword")

from crawler import crawl  # noqa: E402
from crawler.sources import SourceSpec  # noqa: E402
from crawler.providers import FetchResult  # noqa: E402
from database.queries import JobWriteResult  # noqa: E402


class CrawlerControlTests(unittest.TestCase):
    def test_main_exits_zero_for_partial_success_and_nonzero_for_fetch_failure(self):
        with (
            patch.object(crawl, "run", return_value={"status": "partial_success"}),
            patch.object(crawl, "_write_actions_output"),
            patch.object(sys, "argv", ["crawl", "--source", "ats"]),
        ):
            self.assertIsNone(crawl.main())
        with (
            patch.object(crawl, "run", return_value={"status": "failure"}),
            patch.object(crawl, "_write_actions_output"),
            patch.object(sys, "argv", ["crawl", "--source", "ats"]),
        ):
            with self.assertRaises(SystemExit) as raised:
                crawl.main()
        self.assertEqual(raised.exception.code, 1)

    def test_one_database_error_is_partial_success_and_later_rows_continue(self):
        found = [{
            "source": "greenhouse", "source_job_id": str(index),
            "application_link": f"https://example.com/jobs/{index}",
            "job_title": f"Software Engineer Intern {index}", "company": "Example",
        } for index in range(3)]
        with (
            patch.object(crawl, "_log_db_target"),
            patch.object(crawl, "source_specs", return_value=[SourceSpec("greenhouse", "board")]),
            patch.object(crawl.providers, "fetch", return_value=FetchResult(found, discovered=3)),
            patch.object(crawl, "record_sync"),
            patch.object(crawl, "simplify_jobs"),
            patch.object(crawl, "extract_skills_for_jobs"),
            patch.object(crawl, "upsert_job", side_effect=[JobWriteResult("inserted"), JobWriteResult("error", reason="database error: 1406"), JobWriteResult("updated")]) as upsert,
            patch.object(crawl, "backfill_missing_summaries"),
            patch.object(crawl, "backfill_job_skills"),
        ):
            result = crawl.run(source="ats", limit=3, skip_cleanup=True)

        self.assertEqual(upsert.call_count, 3)
        self.assertEqual((result["inserted"], result["updated"], result["error"]), (1, 1, 1))
        self.assertEqual(result["status"], "partial_success")

    def test_true_provider_fetch_failure_is_failure(self):
        with (
            patch.object(crawl, "_log_db_target"),
            patch.object(crawl, "source_specs", return_value=[SourceSpec("greenhouse", "board")]),
            patch.object(crawl.providers, "fetch", side_effect=RuntimeError("source unavailable")),
            patch.object(crawl, "record_sync"),
            patch.object(crawl, "backfill_missing_summaries"),
            patch.object(crawl, "backfill_job_skills"),
        ):
            result = crawl.run(source="ats", limit=3, skip_cleanup=True)

        self.assertEqual(result["source_errors"], 1)
        self.assertEqual(result["status"], "failure")

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
            patch.object(crawl.providers, "fetch", return_value=FetchResult(found, discovered=2)) as fetch,
            patch.object(crawl, "simplify_jobs"),
            patch.object(crawl, "extract_skills_for_jobs"),
            patch.object(crawl, "upsert_job", return_value=JobWriteResult("would_insert", reason="source_job_id")) as upsert,
            patch.object(crawl, "backfill_missing_summaries") as summaries,
            patch.object(crawl, "backfill_job_skills") as skills,
        ):
            crawl.run(dry_run=True, source="linkedin", limit=2)

        cleanup.assert_not_called()
        fetch.assert_called_once()
        self.assertEqual(fetch.call_args.kwargs["max_jobs"], 2)
        self.assertLessEqual(fetch.call_args.kwargs["time_limit_sec"], 3 * 60)
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
            patch.object(crawl, "source_specs", return_value=[SourceSpec("handshake", "h"), SourceSpec("linkedin", "l")]),
            patch.object(crawl.providers, "fetch", side_effect=[RuntimeError("source unavailable"), FetchResult(found, discovered=1)]),
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
            patch.object(crawl, "source_specs", return_value=[SourceSpec("handshake", "h"), SourceSpec("linkedin", "l")]),
            patch.object(crawl.providers, "fetch", side_effect=[FetchResult(handshake, discovered=1), FetchResult(linkedin, discovered=1)]),
        ):
            jobs, stats = crawl.collect_jobs(source="all", limit=3)

        self.assertEqual(len(jobs), 1)
        self.assertEqual(stats["duplicates"], 1)


if __name__ == "__main__":
    unittest.main()
