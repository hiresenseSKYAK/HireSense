import unittest
from pathlib import Path


class MigrationTests(unittest.TestCase):
    def test_company_logo_migration_is_additive_and_nullable(self):
        migration = Path(__file__).parents[1] / "database" / "migrations" / "004_add_company_logo_url.sql"
        sql = migration.read_text(encoding="utf-8").lower()
        self.assertIn("add column company_logo_url varchar(1000) null", sql)
        self.assertNotIn("drop ", sql)
        self.assertNotIn("delete ", sql)

    def test_interview_hardening_migration_is_additive_and_unique(self):
        migration = Path(__file__).parents[1] / "database" / "migrations" / "005_harden_interview_sessions.sql"
        sql = migration.read_text(encoding="utf-8").lower()
        self.assertIn("processing_question_index", sql)
        self.assertIn("provider_call_count", sql)
        self.assertIn("unique index uq_interview_response_question", sql)
        self.assertIn("unique index uq_interview_response_turn", sql)
        self.assertNotIn("drop ", sql)
        self.assertNotIn("delete ", sql)


if __name__ == "__main__":
    unittest.main()
