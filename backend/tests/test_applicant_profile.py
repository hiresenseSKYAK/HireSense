import os
import unittest

os.environ.setdefault("DB_HOST", "test.invalid")
os.environ.setdefault("DB_PORT", "3306")
os.environ.setdefault("DB_NAME", "testdb")
os.environ.setdefault("DB_USER", "testuser")
os.environ.setdefault("DB_PASSWORD", "testpassword")

from services.applicant_profile import build_applicant_profile, split_experience_title


class ApplicantProfileTests(unittest.TestCase):
    def test_splits_common_experience_headings(self):
        self.assertEqual(split_experience_title("Software Engineer Intern at Acme"), ("Acme", "Software Engineer Intern"))
        self.assertEqual(split_experience_title("Acme | Data Analyst"), ("Acme", "Data Analyst"))
        self.assertEqual(split_experience_title("Research Assistant"), ("", "Research Assistant"))

    def test_builds_skills_education_and_experience_for_application_forms(self):
        profile = build_applicant_profile({
            "skills": ["Python", " SQL "],
            "education": ["University of Texas"],
            "experience_entries": [{
                "title": "Intern at HireSense",
                "bullets": ["Built a parser", "Built a parser"],
            }],
        })

        self.assertEqual(profile["skills"], ["Python", "SQL"])
        self.assertEqual(profile["education"][0]["school"], "University of Texas")
        self.assertFalse(profile["education"][0]["current"])
        self.assertFalse(profile["experience"][0]["current"])
        self.assertEqual(profile["experience"][0]["company"], "HireSense")
        self.assertEqual(profile["experience"][0]["title"], "Intern")
        self.assertEqual(profile["experience"][0]["description"], "Built a parser")

    def test_keeps_only_four_entries(self):
        profile = build_applicant_profile({
            "education": [f"School {index}" for index in range(6)],
            "experience_entries": [{"title": f"Role {index}", "bullets": []} for index in range(6)],
        })
        self.assertEqual(len(profile["education"]), 4)
        self.assertEqual(len(profile["experience"]), 4)


if __name__ == "__main__":
    unittest.main()
