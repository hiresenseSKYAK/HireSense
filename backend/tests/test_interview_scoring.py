import os
import unittest

os.environ.setdefault("DB_HOST", "test.invalid")
os.environ.setdefault("DB_PORT", "3306")
os.environ.setdefault("DB_NAME", "testdb")
os.environ.setdefault("DB_USER", "testuser")
os.environ.setdefault("DB_PASSWORD", "testpassword")

from services.interview_service import build_final_result, evaluate_answer, generate_interview_questions


QUESTION = {
    "question_id": "q2",
    "focus_area": "Technical Depth: Python",
    "prompt": "Walk me through a time you used Python in a project. What was the problem, what did you build, and what was the result?",
    "target_keywords": [
        "Python",
        "built",
        "result",
        "impact",
        "designed",
        "Software Engineer Intern at HireSense | Austin, TX | Jun 2024 – Aug 2024",
    ],
}

STAR_ANSWER = (
    "At my internship I was tasked with parsing messy PDF resumes. "
    "I built a Python parser and chose a line-based approach because the files had no reliable layout. "
    "That cut review time by 30%."
)


class InterviewScoringTests(unittest.TestCase):
    def test_short_answer_scores_low(self):
        feedback = evaluate_answer(QUESTION, "Python")

        self.assertLess(feedback["score"], 20)
        self.assertEqual(feedback["benchmark"], "Needs work")
        self.assertEqual(sum(item["score"] for item in feedback["dimensions"]), feedback["score"])

    def test_keyword_stuffing_does_not_score_as_a_strong_answer(self):
        stuffed = "HireSense " * 40 + "Python " * 5
        feedback = evaluate_answer(QUESTION, stuffed)

        self.assertLess(feedback["score"], 55)
        self.assertNotEqual(feedback["benchmark"], "Excellent")

    def test_specific_story_with_a_result_outranks_a_long_generic_answer(self):
        ramble = " ".join(["teamwork is important and communication matters"] * 40)
        story = evaluate_answer(QUESTION, STAR_ANSWER)
        generic = evaluate_answer(QUESTION, ramble)

        self.assertGreaterEqual(story["score"], 70)
        self.assertIn(story["benchmark"], {"Strong", "Excellent"})
        self.assertGreater(story["score"], generic["score"])
        impact = next(item for item in story["dimensions"] if item["label"] == "Impact")
        self.assertEqual(impact["score"], 25)

    def test_final_score_uses_the_question_scores_and_dimension_averages(self):
        strong = evaluate_answer(QUESTION, STAR_ANSWER)
        weak = evaluate_answer(QUESTION, "I like this job.")
        result = build_final_result([
            {"score": strong["score"], "feedback": strong},
            {"score": weak["score"], "feedback": weak},
        ])

        self.assertEqual(result["final_score"], round((strong["score"] + weak["score"]) / 2))
        self.assertEqual([item["label"] for item in result["dimensions"]], ["Relevance", "Structure", "Specificity", "Impact"])
        self.assertTrue(result["next_steps"])

    def test_r_is_a_skill_and_company_blurbs_stay_out_of_questions(self):
        from ai.skill_extraction import _catalog_skills_from_text

        self.assertNotIn("R", _catalog_skills_from_text("The intern will work with the R&D team."))
        self.assertIn("R", _catalog_skills_from_text("Required skills: Python, R, and SQL."))

        questions = generate_interview_questions(
            {
                "job_title": "Data Analyst",
                "company": "DriveTime",
                "job_description": (
                    "What's Under the Hood DriveTime Family of Brands is the largest privately owned "
                    "used car sales finance and servicing company in the nation."
                ),
                "skills": ["Python", "R"],
            },
            {"skills": ["Python"], "project_entries": [], "experience_entries": []},
        )
        prompts = " ".join(question["prompt"] for question in questions)
        self.assertNotIn("What's Under the Hood", prompts)
        self.assertNotIn("used car", prompts)
        self.assertNotIn("in the context of", prompts)
        growth = next(question for question in questions if question["question_id"] == "q4")
        self.assertIn("R", growth["prompt"])


if __name__ == "__main__":
    unittest.main()
