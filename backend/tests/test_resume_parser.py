import os
import unittest

os.environ.setdefault("DB_HOST", "test.invalid")
os.environ.setdefault("DB_PORT", "3306")
os.environ.setdefault("DB_NAME", "testdb")
os.environ.setdefault("DB_USER", "testuser")
os.environ.setdefault("DB_PASSWORD", "testpassword")

from services.applicant_profile import build_applicant_profile
from services.resume_parser import parse_resume_text


SAMPLE_RESUME = """
Ada Lovelace
ada@example.com
(512) 555-1212

Education
University of Texas
Bachelor of Science in Computer Science
August 2022 - May 2026
GPA: 3.8

Skills and Cert
Python, SQL, Docker
AWS Certified Cloud Practitioner

Experience
Software Engineer Intern
HireSense | Austin, TX
June 2024 - August 2024
- Built a parser
- Wrote tests

Data Analyst
Acme Corp
January 2023 - Present
- Analyzed sales data

Projects
HireSense Portal | React, FastAPI
- Built a job tracker

Campus Map
- Mapped campus buildings
"""


class ResumeParserTests(unittest.TestCase):
    def test_groups_supported_fields_and_keeps_skills_out_of_education(self):
        parsed = parse_resume_text(SAMPLE_RESUME)
        profile = build_applicant_profile(parsed)

        self.assertEqual(parsed["name"], "Ada Lovelace")
        self.assertEqual(parsed["email"], "ada@example.com")
        self.assertEqual(len(parsed["education"]), 1)
        self.assertNotIn("Python", " ".join(parsed["education"]))
        self.assertNotIn("AWS Certified Cloud Practitioner", " ".join(parsed["education"]))

        school = profile["education"][0]
        self.assertEqual(school["school"], "University of Texas")
        self.assertEqual(school["degree"], "Bachelor of Science")
        self.assertEqual(school["fieldOfStudy"], "Computer Science")
        self.assertEqual(school["startDate"], "2022-08-01")
        self.assertEqual(school["endDate"], "2026-05-01")
        self.assertFalse(school["current"])

        self.assertIn("Python", parsed["skills"])
        self.assertIn("SQL", parsed["skills"])
        self.assertIn("Docker", parsed["skills"])
        self.assertIn("AWS Certified Cloud Practitioner", parsed["skills"])
        self.assertIn("Python", profile["skills"])
        self.assertNotIn("c", [skill.lower() for skill in parsed["skills"]])

        self.assertEqual(len(profile["experience"]), 2)
        intern = profile["experience"][0]
        self.assertEqual(intern["title"], "Software Engineer Intern")
        self.assertEqual(intern["company"], "HireSense")
        self.assertEqual(intern["location"], "Austin, TX")
        self.assertEqual(intern["startDate"], "2024-06-01")
        self.assertEqual(intern["endDate"], "2024-08-01")
        self.assertFalse(intern["current"])
        self.assertEqual(intern["description"], "Built a parser\nWrote tests")

        analyst = profile["experience"][1]
        self.assertEqual(analyst["title"], "Data Analyst")
        self.assertEqual(analyst["company"], "Acme Corp")
        self.assertEqual(analyst["startDate"], "2023-01-01")
        self.assertEqual(analyst["endDate"], "")
        self.assertTrue(analyst["current"])
        self.assertEqual(analyst["description"], "Analyzed sales data")

        self.assertEqual(len(parsed["project_entries"]), 2)
        self.assertEqual(parsed["project_entries"][0]["title"], "HireSense Portal | React, FastAPI")
        self.assertEqual(parsed["project_entries"][0]["bullets"], ["Built a job tracker"])
        self.assertEqual(parsed["project_entries"][1]["title"], "Campus Map")
        self.assertEqual(parsed["project_entries"][1]["bullets"], ["Mapped campus buildings"])

    def test_second_school_stays_in_its_own_entry(self):
        parsed = parse_resume_text(
            """
            Education
            University of Texas
            B.S. in Computer Science
            August 2022 - May 2026

            Rice University
            M.S. in Computer Science
            August 2026 - May 2028
            """
        )
        profile = build_applicant_profile(parsed)

        self.assertEqual(len(profile["education"]), 2)
        self.assertEqual(profile["education"][0]["school"], "University of Texas")
        self.assertEqual(profile["education"][0]["degree"], "B.S.")
        self.assertEqual(profile["education"][1]["school"], "Rice University")
        self.assertEqual(profile["education"][1]["degree"], "M.S.")
        self.assertEqual(profile["education"][1]["startDate"], "2026-08-01")

    def test_job_title_without_a_role_keyword_stays_with_its_company(self):
        parsed = parse_resume_text(
            """
            Skills & Certifications
            Excel, Public Speaking

            Experience
            Barista
            Cafe Luna | Austin, TX
            May 2024 - Present
            - Opened the shop
            """
        )
        profile = build_applicant_profile(parsed)

        self.assertEqual(parsed["education"], [])
        self.assertEqual(profile["skills"], ["Excel", "Public Speaking"])
        self.assertEqual(profile["experience"][0]["title"], "Barista")
        self.assertEqual(profile["experience"][0]["company"], "Cafe Luna")
        self.assertTrue(profile["experience"][0]["current"])

    def test_wrapped_bullet_stays_with_the_same_job(self):
        parsed = parse_resume_text(
            """
            Experience
            Software Engineer Intern
            HireSense | Austin, TX
            June 2024 - August 2024
            - Built a parser that reads PDF resumes and
            maps education, experience, and skills into fields
            - Wrote tests for the upload flow

            Data Analyst
            Acme Corp
            January 2023 - Present
            - Analyzed sales data for the
            regional team and cut reporting time
            """
        )
        profile = build_applicant_profile(parsed)

        self.assertEqual(len(profile["experience"]), 2)
        intern = profile["experience"][0]
        self.assertEqual(intern["title"], "Software Engineer Intern")
        self.assertEqual(intern["company"], "HireSense")
        self.assertEqual(
            intern["description"],
            "Built a parser that reads PDF resumes and maps education, experience, and skills into fields\n"
            "Wrote tests for the upload flow",
        )
        analyst = profile["experience"][1]
        self.assertEqual(analyst["title"], "Data Analyst")
        self.assertEqual(analyst["company"], "Acme Corp")
        self.assertEqual(
            analyst["description"],
            "Analyzed sales data for the regional team and cut reporting time",
        )

    def test_wrapped_project_bullet_stays_with_the_same_project(self):
        parsed = parse_resume_text(
            """
            Projects
            HireSense Portal | React, FastAPI
            - Built a job tracker that matches students to
            open roles | using resume skills
            - Shipped the first demo

            Campus Map
            - Mapped campus buildings and
            highlighted accessible entrances
            """
        )

        self.assertEqual(len(parsed["project_entries"]), 2)
        portal = parsed["project_entries"][0]
        self.assertEqual(portal["title"], "HireSense Portal | React, FastAPI")
        self.assertEqual(
            portal["bullets"],
            [
                "Built a job tracker that matches students to open roles | using resume skills",
                "Shipped the first demo",
            ],
        )
        campus = parsed["project_entries"][1]
        self.assertEqual(campus["title"], "Campus Map")
        self.assertEqual(
            campus["bullets"],
            ["Mapped campus buildings and highlighted accessible entrances"],
        )

    def test_supports_unusual_section_order_without_mixing_content(self):
        parsed = parse_resume_text(
            """
            Grace Hopper
            grace@example.com

            Projects
            Compiler Toolkit
            - Built a parser in Python

            Skills
            Python, SQL

            Education
            Yale University
            M.S. in Computer Science
            September 1930 - May 1934
            """
        )

        self.assertEqual(parsed["name"], "Grace Hopper")
        self.assertEqual(len(parsed["project_entries"]), 1)
        self.assertIn("Python", parsed["skills"])
        self.assertEqual(parsed["education_entries"][0]["school"], "Yale University")
        self.assertNotIn("Compiler Toolkit", " ".join(parsed["education"]))

    def test_deduplicates_skills_in_a_sparse_resume(self):
        parsed = parse_resume_text(
            """
            Grace Hopper
            grace@example.com

            Skills
            Python, Python, SQL, SQL
            """
        )

        self.assertEqual(parsed["skills"].count("Python"), 1)
        self.assertEqual(parsed["skills"].count("SQL"), 1)


if __name__ == "__main__":
    unittest.main()
