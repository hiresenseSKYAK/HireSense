import os
import unittest

os.environ.setdefault("DB_HOST", "test.invalid")
os.environ.setdefault("DB_PORT", "3306")
os.environ.setdefault("DB_NAME", "testdb")
os.environ.setdefault("DB_USER", "testuser")
os.environ.setdefault("DB_PASSWORD", "testpassword")

from scripts.report_job_geography import audit_active_rows


def row(job_id, **overrides):
    value = {
        "id": job_id,
        "job_title": "Software Engineer Intern",
        "company": "Example",
        "location": "Dallas, TX",
        "work_style": "On-site",
        "job_description": "Build production software.",
    }
    value.update(overrides)
    return value


class JobPolicyCleanupTests(unittest.TestCase):
    def test_audit_separates_geography_and_exact_duplicates(self):
        rows = [
            row(6),
            row(5),
            row(4, location="Ripon, WI"),
            row(3, company="Toyota Automated Logistics", location="Grapevine, TX", job_description="The intern will work with the R&D team in Indianapolis, IN."),
            row(2, location="Remote - United States", work_style="Remote", job_description="Build a remote platform."),
            row(1, job_description="A genuinely different Dallas role."),
        ]

        audit = audit_active_rows(rows)
        self.assertEqual({item["id"] for item in audit["geography"]}, {3, 4})
        self.assertEqual([item["id"] for item in audit["duplicates"]], [5])
        self.assertEqual([item["id"] for item in audit["Remote"]], [2])

    def test_similar_source_postings_are_not_collapsed_when_content_differs(self):
        rows = [
            row(219, company="Sierra Nevada Corporation", job_title="Software Engineer I", location="Plano", job_description="Build AI workflow automation."),
            row(133, company="Sierra Nevada Corporation", job_title="Software Engineer I", location="Plano", job_description="Build aerospace software requiring a security clearance."),
        ]

        audit = audit_active_rows(rows)
        self.assertEqual(audit["duplicates"], [])
        self.assertEqual({item["id"] for item in audit["DFW"]}, {133, 219})

    def test_near_identical_cross_source_repost_is_collapsed(self):
        description = "Build Power Apps automation with the HR development team. " * 20
        rows = [
            row(276, company="State Farm Insurance Companies", location="Dallas, TX", source="handshake", job_description=description.replace("team.", "team!")),
            row(259, company="State Farm", location="Richardson, TX", source="linkedin", job_description=description),
        ]

        audit = audit_active_rows(rows)
        self.assertEqual([item["id"] for item in audit["duplicates"]], [276])
        self.assertIn("cross-source", audit["duplicates"][0]["reason"])


if __name__ == "__main__":
    unittest.main()
