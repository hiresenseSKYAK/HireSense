import unittest

from crawler.sources import (
    DEFAULT_SOURCE_TIME_LIMITS_SEC,
    HANDSHAKE_URLS,
    LINKEDIN_URLS,
    PER_SEARCH_TIME_LIMIT_SEC,
    source_urls,
)


class SourceConfigurationTests(unittest.TestCase):
    def test_linkedin_has_dallas_and_remote_coverage(self):
        self.assertGreaterEqual(len(LINKEDIN_URLS), 20)
        self.assertTrue(any("Dallas-Fort" in url for url in LINKEDIN_URLS))
        self.assertTrue(any("f_WT=2" in url for url in LINKEDIN_URLS))

    def test_all_sources_are_included(self):
        configured = source_urls("all")
        self.assertEqual(len(configured), len(LINKEDIN_URLS) + len(HANDSHAKE_URLS))

    def test_handshake_has_no_nationwide_role_grid(self):
        self.assertFalse(any("/role/" in url for url in HANDSHAKE_URLS))
        self.assertTrue(all("/dallas-tx/" in url or "/remote/" in url for url in HANDSHAKE_URLS))

    def test_scheduled_source_budgets_fit_workflow_timeout(self):
        # The workflow timeout is 45 minutes. Reserve at least ten minutes for
        # checkout, dependency installation, migrations, and reporting.
        scheduled_seconds = (
            DEFAULT_SOURCE_TIME_LIMITS_SEC["linkedin"]
            + DEFAULT_SOURCE_TIME_LIMITS_SEC["handshake"]
        )
        self.assertLessEqual(scheduled_seconds, 35 * 60)
        self.assertLessEqual(PER_SEARCH_TIME_LIMIT_SEC, 3 * 60)


if __name__ == "__main__":
    unittest.main()
