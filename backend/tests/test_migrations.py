import os
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

os.environ.setdefault("DB_HOST", "test.invalid")
os.environ.setdefault("DB_PORT", "3306")
os.environ.setdefault("DB_NAME", "testdb")
os.environ.setdefault("DB_USER", "testuser")
os.environ.setdefault("DB_PASSWORD", "testpassword")

from database import migrate  # noqa: E402


class MigrationTests(unittest.TestCase):
    def test_location_migration_upgrades_existing_schema_without_touching_rows(self):
        migration = Path(__file__).parents[1] / "database" / "migrations" / "007_widen_job_location.sql"
        sql = migration.read_text(encoding="utf-8").lower()
        self.assertIn("alter table job_data modify column location varchar(512) null", sql)
        self.assertNotIn("drop ", sql)
        self.assertNotIn("delete ", sql)
        self.assertNotIn("create table job_data", sql)

        cursor = Mock()
        cursor.fetchall.return_value = [(path.name,) for path in migration.parent.glob("00[1-6]_*.sql")]
        connection = Mock()
        connection.cursor.return_value = cursor
        with patch.object(migrate, "get_connection", return_value=connection):
            applied = migrate.migrate(through=7)

        self.assertEqual(applied, [migration.name])
        statements = [call.args[0].lower() for call in cursor.execute.call_args_list]
        self.assertEqual(sum("modify column location varchar(512) null" in statement for statement in statements), 1)
        self.assertFalse(any("delete from job_data" in statement or "drop table job_data" in statement for statement in statements))

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

    def test_job_ingestion_migration_preserves_records_and_adds_indexes(self):
        migration = Path(__file__).parents[1] / "database" / "migrations" / "006_job_ingestion.sql"
        sql = migration.read_text(encoding="utf-8").lower()
        for token in ("source_updated_at", "last_verified_at", "job_source_health",
                      "job_source_alias", "ix_job_data_active_seen", "ix_job_data_canonical_url"):
            self.assertIn(token, sql)
        self.assertNotIn("drop table", sql)
        self.assertNotIn("delete from", sql)


if __name__ == "__main__":
    unittest.main()
