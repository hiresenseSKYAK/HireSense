import os
import unittest
from unittest.mock import Mock, patch

import requests

os.environ.setdefault("DB_HOST", "test.invalid")
os.environ.setdefault("DB_PORT", "3306")
os.environ.setdefault("DB_NAME", "testdb")
os.environ.setdefault("DB_USER", "testuser")
os.environ.setdefault("DB_PASSWORD", "testpassword")

from services import updater


class UpdaterTests(unittest.TestCase):
    def test_404_is_confirmed_closed(self):
        session = Mock()
        session.get.return_value = Mock(status_code=404, text="")
        self.assertEqual(
            updater.classify_application_link("https://example.com/job", session),
            (True, "http 404"),
        )

    def test_temporary_failures_are_inconclusive(self):
        for status in (302, 401, 403, 429, 500, 503):
            session = Mock()
            session.get.return_value = Mock(status_code=status, text="")
            expired, _ = updater.classify_application_link("https://example.com/job", session)
            self.assertIsNone(expired)

        session = Mock()
        session.get.side_effect = requests.Timeout()
        expired, _ = updater.classify_application_link("https://example.com/job", session)
        self.assertIsNone(expired)

    def test_closed_job_is_deactivated_not_deleted(self):
        rows = [{"id": 7, "application_link": "https://example.com/job"}]
        with (
            patch.object(updater, "get_jobs_to_check", return_value=rows),
            patch.object(updater, "classify_application_link", return_value=(True, "http 410")),
            patch.object(updater, "update_job_check_status", return_value=True) as status,
            patch.object(updater.time, "sleep"),
        ):
            result = updater.update_database()

        status.assert_called_once_with(7, active=False)
        self.assertEqual(result["deactivated"], 1)

    def test_transient_failure_only_records_check(self):
        rows = [{"id": 8, "application_link": "https://example.com/job"}]
        with (
            patch.object(updater, "get_jobs_to_check", return_value=rows),
            patch.object(updater, "classify_application_link", return_value=(None, "http 429")),
            patch.object(updater, "update_job_check_status", return_value=True) as status,
            patch.object(updater.time, "sleep"),
        ):
            result = updater.update_database()

        status.assert_called_once_with(8, active=None)
        self.assertEqual(result["inconclusive"], 1)


if __name__ == "__main__":
    unittest.main()
