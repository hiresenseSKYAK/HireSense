import unittest

from services.job_location import assess_job_geography, assess_job_location
from crawler.parsers.handshake import _location_from_card, _location_from_posting


class JobLocationTests(unittest.TestCase):
    def assert_category(self, location, category, work_style="On-site"):
        decision = assess_job_location(location, work_style)
        self.assertTrue(decision.accepted, decision.reason)
        self.assertEqual(decision.category, category)

    def assert_rejected(self, location, work_style="On-site"):
        decision = assess_job_location(location, work_style)
        self.assertFalse(decision.accepted, decision.reason)
        self.assertIsNone(decision.category)

    def test_primary_dfw_cities_are_accepted(self):
        for location in (
            "Dallas, TX", "Fort Worth, Texas", "Plano", "Irving, TX",
            "Richardson", "Frisco, TX", "Arlington", "Denton, Texas",
        ):
            with self.subTest(location=location):
                self.assert_category(location, "DFW")

        self.assert_category("Dallas, TX, United States", "DFW")

    def test_dfw_wording_is_accepted(self):
        for location in ("Dallas-Fort Worth Metroplex", "DFW Area", "North Texas"):
            with self.subTest(location=location):
                self.assert_category(location, "DFW")

    def test_realistic_surrounding_dfw_cities_are_accepted(self):
        for location in (
            "Addison, TX", "McKinney", "Flower Mound", "Grapevine, Texas",
            "Southlake, TX", "Westlake, TX",
        ):
            with self.subTest(location=location):
                self.assert_category(location, "DFW")

    def test_explicit_us_remote_is_accepted_as_remote_not_dfw(self):
        self.assert_category("United States", "Remote", work_style="Remote")
        self.assert_category("Remote - US", "Remote")
        self.assertNotEqual(assess_job_location("Dallas, TX", "Remote").category, "DFW")

    def test_foreign_and_ambiguous_remote_roles_are_rejected(self):
        for location in (
            "Toronto, ON, Canada",
            "London, United Kingdom",
            "Remote in London, UK",
            "Remote or hybrid in Toronto, Canada",
            "Remote",
        ):
            with self.subTest(location=location):
                self.assert_rejected(location, work_style="Remote")

    def test_us_state_evidence_accepts_remote_role(self):
        self.assert_category("Remote — California, United States", "Remote", work_style="Remote")

    def test_outside_markets_are_rejected(self):
        for location in (
            "Austin, TX", "Houston, TX", "New York, NY", "San Jose, CA",
            "Ripon, WI", "Provo, UT", "Cincinnati, OH", "Pittsburgh, PA",
            "California",
        ):
            with self.subTest(location=location):
                self.assert_rejected(location)

    def test_ambiguous_locations_are_rejected(self):
        for location in (None, "", "United States", "Texas", "Multiple locations"):
            with self.subTest(location=location):
                self.assert_rejected(location)

    def test_dfw_city_with_explicit_non_texas_state_is_rejected(self):
        self.assert_rejected("Dallas, OR")

    def test_handshake_card_preserves_state_and_country(self):
        location = _location_from_card({
            "parsedLocations": [{"city": "Arlington", "state": "VA", "country": "United States"}],
        })
        self.assertEqual(location, "Arlington, VA, United States")
        self.assert_rejected(location)

    def test_handshake_posting_preserves_state_and_country(self):
        location = _location_from_posting({
            "jobLocation": [{"address": {
                "addressLocality": "Plano",
                "addressRegion": "IL",
                "addressCountry": "US",
            }}],
        })
        self.assertEqual(location, "Plano, IL, US")
        self.assert_rejected(location)

    def test_dfw_location_is_rejected_when_description_has_strong_conflict(self):
        decision = assess_job_geography(
            "Grapevine, TX",
            "On-site",
            "The Software Engineer Intern will work with the R&D team in Indianapolis, IN to build robots.",
        )
        self.assertFalse(decision.accepted)
        self.assertIn("Indianapolis, IN", decision.reason)

    def test_remote_roles_ignore_unrelated_office_mentions(self):
        decision = assess_job_geography(
            "Remote - United States",
            "Remote",
            "Collaborate with teams and visit our office in New York, NY when needed.",
        )
        self.assertTrue(decision.accepted)
        self.assertEqual(decision.category, "Remote")


if __name__ == "__main__":
    unittest.main()
