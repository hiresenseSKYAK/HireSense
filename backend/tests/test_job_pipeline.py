import os
import unittest
from datetime import date
from unittest.mock import patch


os.environ.setdefault("DB_HOST", "test.invalid")
os.environ.setdefault("DB_PORT", "3306")
os.environ.setdefault("DB_NAME", "testdb")
os.environ.setdefault("DB_USER", "testuser")
os.environ.setdefault("DB_PASSWORD", "testpassword")

from database import queries  # noqa: E402
from database.job_identity import normalize_application_url  # noqa: E402


def job(**overrides):
    value = {
        "source": "linkedin",
        "source_job_id": "12345",
        "job_title": "Software Engineer Intern",
        "company": "Example Co",
        "location": "Dallas, TX",
        "salary": 50000,
        "date_posted": "2026-09-15",
        "application_link": "https://example.com/jobs/12345",
        "job_description": "Build useful software.",
        "job_description_summary": "Useful software internship.",
        "skills": ["Python"],
        "job_type": "Internship",
        "experience_level": "Internship",
        "work_style": "Hybrid",
    }
    value.update(overrides)
    return value


class MemoryRepository:
    def __init__(self, state):
        self.state = state

    def find_matches(self, record):
        matches = []
        for row in self.state["rows"]:
            same_source = (
                record.get("source")
                and record.get("source_job_id")
                and row.get("source") == record["source"]
                and row.get("source_job_id") == record["source_job_id"]
            )
            if (
                row.get("identity_key") == record["identity_key"]
                or same_source
                or (record.get("canonical_url") and row.get("canonical_url") == record["canonical_url"])
                or (record.get("application_link") and row.get("application_link") == record["application_link"])
            ):
                matches.append(dict(row))
        return matches[:2]

    def insert(self, record):
        row = {"id": self.state["next_id"], **record}
        self.state["next_id"] += 1
        self.state["rows"].append(row)
        return row["id"]

    def update(self, job_id, changes):
        row = next(item for item in self.state["rows"] if item["id"] == job_id)
        row.update(changes)

    def touch_seen(self, job_id):
        row = next(item for item in self.state["rows"] if item["id"] == job_id)
        row["active"] = True
        self.state["touches"] = self.state.get("touches", 0) + 1

    def commit(self):
        pass

    def rollback(self):
        pass

    def close(self):
        pass


class JobUpsertTests(unittest.TestCase):
    def setUp(self):
        self.state = {"rows": [], "next_id": 1}
        self.factory = lambda: MemoryRepository(self.state)
        self.schema_patch = patch.object(queries, "ensure_job_description_summary_column")
        self.schema_patch.start()

    def tearDown(self):
        self.schema_patch.stop()

    def upsert(self, value):
        return queries.upsert_job(value, repository_factory=self.factory)

    def test_same_source_job_id_twice_does_not_duplicate(self):
        first = self.upsert(job())
        second = self.upsert(job(application_link="https://company.example/apply/12345"))

        self.assertEqual(first.action, "inserted")
        self.assertEqual(second.action, "updated")
        self.assertEqual(len(self.state["rows"]), 1)
        self.assertEqual(self.state["rows"][0]["application_link"], "https://company.example/apply/12345")

    def test_same_normalized_url_twice_does_not_duplicate(self):
        first = job(source=None, source_job_id=None, application_link="HTTPS://WWW.Example.com/jobs/7/?utm_source=test&b=2&a=1#apply")
        second = job(source=None, source_job_id=None, application_link="https://example.com/jobs/7?a=1&b=2")

        self.assertEqual(normalize_application_url(first["application_link"]), normalize_application_url(second["application_link"]))
        self.assertEqual(self.upsert(first).action, "inserted")
        self.assertIn(self.upsert(second).action, {"updated", "unchanged"})
        self.assertEqual(len(self.state["rows"]), 1)

    def test_changed_metadata_updates_existing_job(self):
        self.upsert(job())
        result = self.upsert(job(job_title="Updated Software Internship", salary=62000, work_style="Remote"))

        self.assertEqual(result.action, "updated")
        self.assertEqual(set(result.changed_fields), {"job_title", "salary", "work_style"})
        self.assertEqual(self.state["rows"][0]["job_title"], "Updated Software Internship")
        self.assertEqual(self.state["rows"][0]["salary"], 62000)

    def test_repeated_crawler_runs_are_idempotent(self):
        jobs = [job(source_job_id="1", application_link="https://example.com/jobs/1"), job(source_job_id="2", application_link="https://example.com/jobs/2")]
        first_actions = [self.upsert(value).action for value in jobs]
        second_actions = [self.upsert(value).action for value in jobs]

        self.assertEqual(first_actions, ["inserted", "inserted"])
        self.assertEqual(second_actions, ["unchanged", "unchanged"])
        self.assertEqual(len(self.state["rows"]), 2)

    def test_mysql_date_object_does_not_create_a_false_update(self):
        self.upsert(job())
        self.state["rows"][0]["date_posted"] = date(2026, 9, 15)

        result = self.upsert(job())

        self.assertEqual(result.action, "unchanged")

    def test_invalid_application_url_is_skipped(self):
        result = self.upsert(job(application_link="javascript:alert(1)"))

        self.assertEqual(result.action, "skipped")
        self.assertIn("application URL", result.reason)
        self.assertEqual(self.state["rows"], [])

    def test_missing_required_job_metadata_is_skipped(self):
        result = self.upsert(job(company="  "))

        self.assertEqual(result.action, "skipped")
        self.assertIn("title or company", result.reason)


if __name__ == "__main__":
    unittest.main()
