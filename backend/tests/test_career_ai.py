import unittest
from unittest.mock import Mock

from services.career_ai import CareerAIService, fallback_job_preparation, fallback_resume_coach
from services.interview_settings import InterviewAISettings


SETTINGS = InterviewAISettings(api_key='test', model='gpt-4o-mini', light_model='gpt-4o-mini',
                               timeout_seconds=10, max_output_tokens=900, max_retries=0)
RESUME = {
    'name': 'Private Person', 'email': 'private@example.com', 'phone': '555-222-1212',
    'skills': ['Python', 'AWS'],
    'project_entries': [{'title': 'Parser', 'bullets': ['Built a Python parser and reduced review time by 30%.']}],
}
JOB = {'title': 'Engineer', 'company': 'Acme', 'description': 'Build APIs with Python and SQL.',
       'skills': ['Python', 'SQL']}


class CareerAITests(unittest.TestCase):
    def test_deterministic_resume_coach_never_invents_metrics(self):
        result = fallback_resume_coach(RESUME)
        self.assertIn('30%', str(result))
        self.assertNotIn('50%', str(result))
        self.assertNotIn('private@example.com', str(result))

    def test_job_preparation_preserves_authoritative_missing_skills(self):
        result = fallback_job_preparation(JOB, RESUME)
        self.assertEqual(result['missing_requirements'], ['SQL'])
        self.assertNotIn('Kubernetes', str(result))

    def test_ai_resume_output_with_invented_metric_falls_back(self):
        client = Mock()
        client.complete.return_value = {
            'strongest_evidence': [],
            'bullet_coaching': [{'evidence': 'Built a Python parser and reduced review time by 30%.',
                                 'issue': 'Needs impact.', 'recommendation': 'Say it improved speed by 50%.'}],
            'repeated_phrasing': [], 'skills_without_evidence': [], 'summary_guidance': [],
        }
        result = CareerAIService(client, SETTINGS).resume_coach(91001, RESUME)
        self.assertEqual(result['source'], 'fallback')
        self.assertNotIn('50%', str(result))

    def test_ai_job_fit_requires_job_and_resume_grounding(self):
        client = Mock()
        client.complete.return_value = {
            'alignment': 'Strong alignment',
            'strongest_matches': [{'requirement': 'Kubernetes', 'resume_evidence': 'Invented cluster work'}],
            'missing_requirements': [], 'likely_interview_topics': [], 'experiences_to_emphasize': [],
            'application_talking_points': [], 'professional_summary': '',
            'recruiter_screen_questions': [], 'skill_gaps': [],
        }
        result = CareerAIService(client, SETTINGS).job_preparation(91002, JOB, RESUME)
        self.assertEqual(result['source'], 'fallback')
        self.assertNotIn('Kubernetes', str(result))

    def test_ai_job_summary_cannot_claim_an_unsupported_technology(self):
        client = Mock()
        client.complete.return_value = {
            'alignment': 'Moderate alignment', 'strongest_matches': [],
            'missing_requirements': ['SQL'], 'likely_interview_topics': [],
            'experiences_to_emphasize': [], 'resume_tailoring': [],
            'application_talking_points': [],
            'professional_summary': 'I have Kubernetes deployment experience.',
            'recruiter_screen_questions': [], 'skill_gaps': [],
        }
        result = CareerAIService(client, SETTINGS).job_preparation(91003, JOB, RESUME)
        self.assertEqual(result['source'], 'fallback')
        self.assertNotIn('Kubernetes', str(result))

    def test_provider_prompt_excludes_contact_fields_and_preserves_untrusted_boundary(self):
        client = Mock()
        client.complete.return_value = fallback_resume_coach(RESUME)
        result = CareerAIService(client, SETTINGS).resume_coach(91004, RESUME)
        self.assertEqual(result['source'], 'ai')
        messages = client.complete.call_args.kwargs['messages']
        self.assertNotIn('private@example.com', str(messages))
        self.assertNotIn('Private Person', str(messages))
        self.assertIn('BEGIN UNTRUSTED CAREER DATA', messages[1]['content'])

    def test_ai_job_preparation_uses_server_alignment_and_missing_requirements(self):
        client = Mock()
        client.complete.return_value = {
            'alignment': 'Strong alignment', 'strongest_matches': [],
            'missing_requirements': [], 'likely_interview_topics': ['Python'],
            'experiences_to_emphasize': [], 'resume_tailoring': [],
            'application_talking_points': [], 'professional_summary': 'I built a Python parser.',
            'recruiter_screen_questions': [], 'skill_gaps': [],
        }
        result = CareerAIService(client, SETTINGS).job_preparation(91005, JOB, RESUME)
        self.assertEqual(result['source'], 'ai')
        self.assertEqual(result['missing_requirements'], ['SQL'])
        self.assertNotEqual(result['alignment'], 'Strong alignment')


if __name__ == '__main__':
    unittest.main()
