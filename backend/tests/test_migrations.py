import unittest
from pathlib import Path


class MigrationTests(unittest.TestCase):
    def test_company_logo_migration_is_additive_and_nullable(self):
        migration = Path(__file__).parents[1] / "database" / "migrations" / "004_add_company_logo_url.sql"
        sql = migration.read_text(encoding="utf-8").lower()
        self.assertIn("add column company_logo_url varchar(1000) null", sql)
        self.assertNotIn("drop ", sql)
        self.assertNotIn("delete ", sql)


if __name__ == "__main__":
    unittest.main()
