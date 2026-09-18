import unittest

from services.job_relevance import assess_job_relevance


class JobRelevanceTests(unittest.TestCase):
    def test_accepts_required_technology_titles(self):
        titles = [
            "Software Engineer Intern",
            "Software Development Intern",
            "IT Intern – Data Engineering",
            "Data Science Intern",
            "Cybersecurity Intern",
            "Cloud Engineering Intern",
            "Full Stack Developer Intern",
        ]
        for title in titles:
            with self.subTest(title=title):
                self.assertTrue(assess_job_relevance(title).relevant)

    def test_rejects_required_unrelated_titles(self):
        titles = [
            "Photography Internship",
            "Marketing Operations Intern",
            "Investment Summer Analyst",
            "Actuarial Summer Internship",
            "Civil Engineering Internship",
            "Field Engineer Internship",
        ]
        for title in titles:
            with self.subTest(title=title):
                decision = assess_job_relevance(title)
                self.assertFalse(decision.relevant)
                self.assertIn("title signal", decision.reason)

    def test_unusual_title_can_use_strong_description_evidence(self):
        decision = assess_job_relevance(
            "Technology Rotation Intern",
            "Build Python APIs and use Git source control for software delivery.",
        )
        self.assertTrue(decision.relevant)
        self.assertIn("description signals", decision.reason)

    def test_negative_title_can_be_overridden_only_by_clear_technology_evidence(self):
        decision = assess_job_relevance(
            "Software Field Engineering Intern",
            "Develop Python software and maintain cloud API services.",
        )
        self.assertTrue(decision.relevant)

    def test_unrelated_discipline_is_not_overridden_by_incidental_description_terms(self):
        decision = assess_job_relevance(
            "Civil Engineering Intern - Land Development",
            "Use Python and SQL tools while supporting land development projects.",
        )
        self.assertFalse(decision.relevant)

    def test_finance_title_is_rejected_even_with_incidental_technical_tools(self):
        decision = assess_job_relevance(
            "Investment Summer Analyst",
            "Analyze investments with Python, SQL, and cloud dashboards.",
        )
        self.assertFalse(decision.relevant)


if __name__ == "__main__":
    unittest.main()
