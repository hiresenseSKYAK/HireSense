import unittest

from crawler.parsers.linkedin import _extract_external_url_from_description, _is_external_apply_link
from database.job_identity import normalize_application_url


class ApplicationLinkTests(unittest.TestCase):
    def test_accepts_real_https_employer_or_ats_link(self):
        link = "https://boards.greenhouse.io/example/jobs/123?gh_src=career"
        self.assertTrue(_is_external_apply_link(link))
        self.assertEqual(_extract_external_url_from_description(f"Apply at {link}"), link)

    def test_rejects_unsafe_or_credentialed_urls(self):
        self.assertFalse(_is_external_apply_link("javascript:alert(1)"))
        self.assertFalse(_is_external_apply_link("https://user:pass@example.com/jobs/1"))
        self.assertIsNone(normalize_application_url("file:///etc/passwd"))

    def test_normalization_preserves_functional_query_values(self):
        value = normalize_application_url(
            "https://jobs.example.com/apply/7/?token=abc&utm_source=linkedin#form"
        )
        self.assertEqual(value, "https://jobs.example.com/apply/7?token=abc")


if __name__ == "__main__":
    unittest.main()
