import unittest

from crawler.sources import HANDSHAKE_URLS, LINKEDIN_URLS, source_urls


class SourceConfigurationTests(unittest.TestCase):
    def test_linkedin_has_dallas_and_remote_coverage(self):
        self.assertGreaterEqual(len(LINKEDIN_URLS), 20)
        self.assertTrue(any("Dallas-Fort" in url for url in LINKEDIN_URLS))
        self.assertTrue(any("f_WT=2" in url for url in LINKEDIN_URLS))

    def test_all_sources_are_included(self):
        configured = source_urls("all")
        self.assertEqual(len(configured), len(LINKEDIN_URLS) + len(HANDSHAKE_URLS))


if __name__ == "__main__":
    unittest.main()
