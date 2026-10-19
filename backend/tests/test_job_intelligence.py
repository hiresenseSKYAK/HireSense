import unittest
from unittest.mock import Mock
from datetime import datetime

from services.career_ai import CareerAIService
from services.interview_settings import InterviewAISettings
from services.job_intelligence import (
    apply_bounded_rerank, candidate_context, coaching_signals_from_feedback, rank_recommendations,
)
from services.job_listing import assemble_job_page


RESUME = {
    'email': 'private@example.com', 'skills': ['Python', 'SQL'],
    'project_entries': [{'title': 'API project', 'bullets': ['Built a Python API backed by SQL.']}],
}
JOBS = [
    {'id': 1, 'title': 'Backend Engineer Intern', 'company': 'A', 'location': 'Dallas, TX',
     'tags': ['Python', 'SQL', 'AWS'], 'datePosted': '2026-10-18', 'firstSeenAt': '2026-10-18T00:00:00',
     'experienceLevel': 'Internship', 'applicationLink': 'https://example.com/1'},
    {'id': 2, 'title': 'Backend Engineer Intern', 'company': 'B', 'location': 'Plano, TX',
     'tags': ['Python', 'SQL', 'AWS'], 'datePosted': '2026-06-01', 'firstSeenAt': '2026-06-01T00:00:00',
     'experienceLevel': 'Internship', 'applicationLink': 'https://example.com/2'},
    {'id': 3, 'title': 'Frontend Intern', 'company': 'C', 'location': 'Dallas, TX',
     'tags': ['React'], 'datePosted': '2026-10-18', 'experienceLevel': 'Internship',
     'applicationLink': 'https://example.com/3'},
]
SETTINGS = InterviewAISettings(api_key='test', model='fixture', light_model='fixture',
                               timeout_seconds=10, max_output_tokens=900, max_retries=0)


class JobIntelligenceTests(unittest.TestCase):
    def test_resume_evidence_freshness_and_missing_skill_are_truthful(self):
        context = candidate_context(RESUME, ['Past interview coaching repeatedly flagged AWS for preparation.'])
        ranked = rank_recommendations(JOBS, context, datetime(2026, 10, 19))
        self.assertEqual([item['id'] for item in ranked], [1, 2])
        self.assertIn('API project', ranked[0]['whyThisFits'])
        self.assertEqual(ranked[0]['topGap'], 'AWS')
        self.assertIn('AWS', ranked[0]['preparationNote'])
        self.assertNotIn('private@example.com', str(context) + str(ranked))
        self.assertNotIn('React', str(ranked))

    def test_semantic_order_cannot_cross_deterministic_bands(self):
        candidates = [{**job, '_rank': score} for job, score in zip(JOBS, (80, 75, 45))]
        result = apply_bounded_rerank(candidates, [3, 2, 1])
        self.assertEqual([item['id'] for item in result], [1, 2, 3])

    def test_repeated_interview_gap_is_preparation_only(self):
        signals = coaching_signals_from_feedback([
            {'improvements': ['Explain AWS tradeoffs.']},
            {'improvements': ['Give a concrete AWS example.']},
        ])
        self.assertEqual(len(signals), 1)
        ranked = rank_recommendations(JOBS, candidate_context(RESUME, signals), datetime(2026, 10, 19))
        uncoached = rank_recommendations(JOBS, candidate_context(RESUME), datetime(2026, 10, 19))
        self.assertEqual([item['match'] for item in ranked], [item['match'] for item in uncoached])

    def test_no_invented_resume_quote_or_structured_requirement(self):
        posting = {**JOBS[0], 'tags': ['Python'],
                   'fullDescription': 'We use Python. AWS is mentioned as an optional team tool.'}
        ranked = rank_recommendations([posting], candidate_context({'skills': ['Python']}), datetime(2026, 10, 19))
        self.assertEqual(len(ranked), 1)
        self.assertNotIn('evidence:', ranked[0]['whyThisFits'])
        self.assertIsNone(ranked[0]['topGap'])

    def test_identical_requests_cached_and_users_isolated(self):
        client = Mock()
        jobs = JOBS + [{**JOBS[0], 'id': 4, 'company': 'D', 'datePosted': '2026-10-17'}]
        client.complete.return_value = {'ordered_ids': [1, 2, 4]}
        service = CareerAIService(client, SETTINGS)
        first = service.recommendations(982101, jobs, RESUME)
        second = service.recommendations(982101, jobs, RESUME)
        third = service.recommendations(982102, jobs, RESUME)
        self.assertFalse(first['cached'])
        self.assertTrue(second['cached'])
        self.assertFalse(third['cached'])
        self.assertEqual(client.complete.call_count, 2)
        self.assertNotIn('private@example.com', str(client.complete.call_args.kwargs['messages']))

    def test_ai_unavailable_keeps_deterministic_recommendations(self):
        result = CareerAIService(None, SETTINGS).recommendations(982103, JOBS, RESUME)
        self.assertEqual(result['ranking_source'], 'deterministic')
        self.assertEqual(result['items'][0]['id'], 1)

    def test_natural_query_keeps_structured_filters_authoritative(self):
        result = assemble_job_page(JOBS, q='backend new grad jobs in Dallas', cities=['Dallas'])
        self.assertEqual([item['id'] for item in result['items']], [1])
        no_match = assemble_job_page(JOBS, q='Java jobs where I do not need 3 years of experience')
        self.assertEqual(no_match['total'], 0)
