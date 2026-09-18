import unittest

from services.job_experience import assess_job_experience


class JobExperienceTests(unittest.TestCase):
    def test_accepts_target_levels(self):
        for title, level in (
            ("Software Engineer Intern", "Internship"),
            ("Software, Data & AI Engineering Interns", "Internship"),
            ("Junior Software Developer", "Entry level"),
            ("New Grad Cloud Engineer", "Entry level"),
            ("Software Engineer I", "Entry level"),
            ("Software Engineer - Graduate", "Entry level"),
        ):
            with self.subTest(title=title):
                self.assertEqual(assess_job_experience(title).level, level)

    def test_rejects_senior_titles(self):
        for title in (
            "Senior Software Engineer", "Staff Developer", "Principal Engineer",
            "Lead Software Engineer", "Engineering Manager", "Software Architect",
        ):
            with self.subTest(title=title):
                self.assertFalse(assess_job_experience(title, source_level="Entry level").accepted)

    def test_internship_ignores_unrelated_senior_word_in_description(self):
        decision = assess_job_experience(
            "Software Engineering Intern", "Present findings to senior leadership."
        )
        self.assertTrue(decision.accepted)

    def test_rejects_entry_role_requiring_significant_experience(self):
        decision = assess_job_experience(
            "Entry Level Software Engineer", "Must have at least 5 years of experience."
        )
        self.assertFalse(decision.accepted)

    def test_company_age_does_not_look_like_required_experience(self):
        decision = assess_job_experience(
            "Associate Software Engineer", "A company with 40+ years in business."
        )
        self.assertTrue(decision.accepted)


if __name__ == "__main__":
    unittest.main()
