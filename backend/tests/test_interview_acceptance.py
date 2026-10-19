import copy
import unittest

from services.interview_engine import InterviewEngine, interview_context
from services.interview_provider import ProviderRefusalError


ANSWER = 'I built a Python API, tested failures, and reduced review time by 30%.'
CONTEXT = interview_context({'job_title': 'Backend Intern', 'skills': ['Python']}, {'skills': ['Python']}, 'technical', 3)
QUESTION = {'question_type': 'technical', 'prompt': 'How did you validate the Python API?'}


def valid():
    return {
        'score': 60, 'summary': 'A specific implementation and test example.',
        'strengths': ['You described building and testing the API.'],
        'improvements': ['Explain the failure tests in more detail.'],
        'dimensions': [{'label': label, 'score': 15} for label in ('Relevance', 'Structure', 'Specificity', 'Impact')],
        'evidence': ['built a Python API', 'reduced review time by 30%'],
        'example_stronger_framing': 'I built a Python API, tested failures, and reduced review time by 30%.',
        'follow_up': 'Which Python API failure did you test?',
    }


class Provider:
    provider_name = 'synthetic'
    model = 'fixture'

    def __init__(self, output, repaired=None):
        self.output = output
        self.repaired = repaired
        self.repairs = 0

    def evaluate(self, *args):
        if isinstance(self.output, Exception):
            raise self.output
        return copy.deepcopy(self.output)

    def repair_evaluation(self, *args):
        self.repairs += 1
        return copy.deepcopy(self.repaired)


class EvaluationAcceptanceTests(unittest.TestCase):
    def feedback(self, provider):
        return InterviewEngine(provider).feedback(CONTEXT, QUESTION, ANSWER, [])

    def test_exact_valid_and_score_normalization(self):
        self.assertEqual(self.feedback(Provider(valid()))['source'], 'ai')
        drifted = dict(valid(), score=94)
        result = self.feedback(Provider(drifted))
        self.assertEqual((result['source'], result['score']), ('ai', 60))

    def test_punctuation_evidence_and_invalid_optional_fields(self):
        output = valid()
        output['evidence'] = ['I built a “Python API”', 'invented result']
        output['follow_up'] = 'Which Kubernetes cluster did you configure?'
        output['example_stronger_framing'] = 'I used AWS and improved latency by 85%.'
        output['strengths'].append('I built a Kubernetes cluster.')
        provider = Provider(output)
        result = self.feedback(provider)
        self.assertEqual(result['source'], 'ai')
        self.assertEqual(result['evidence'], ['I built a “Python API”'])
        self.assertIsNone(result['follow_up'])
        self.assertEqual(result['example_stronger_framing'], '')
        self.assertEqual(len(result['strengths']), 1)
        self.assertEqual(provider.repairs, 0)

    def test_repairable_schema_issue_gets_one_repair_and_keeps_ai_source(self):
        output = valid()
        output.pop('summary')
        provider = Provider(output, valid())
        with self.assertLogs('services.interview_engine', level='INFO') as logs:
            result = self.feedback(provider)
        self.assertEqual((result['source'], provider.repairs), ('ai', 1))
        self.assertIn('evaluation_repair_attempted', ' '.join(logs.output))
        self.assertIn('evaluation_repair_accepted', ' '.join(logs.output))
        self.assertNotIn(ANSWER, ' '.join(logs.output))

    def test_invalid_repair_falls_back_once(self):
        output = valid()
        output.pop('summary')
        invalid_repair = dict(valid(), evidence=['invented work'])
        provider = Provider(output, invalid_repair)
        self.assertEqual(self.feedback(provider)['source'], 'fallback')
        self.assertEqual(provider.repairs, 1)

    def test_genuinely_bad_outputs_never_repair(self):
        from openai import AuthenticationError
        import httpx
        request = httpx.Request('POST', 'https://api.openai.com/v1/responses')
        auth = AuthenticationError('private answer', response=httpx.Response(401, request=request), body=None)
        for output in (
            dict(valid(), evidence=['invented work']),
            dict(valid(), dimensions=[]),
            ProviderRefusalError('private answer'),
            TimeoutError('private answer'),
            auth,
        ):
            with self.subTest(output=type(output).__name__):
                provider = Provider(output, valid())
                self.assertEqual(self.feedback(provider)['source'], 'fallback')
                self.assertEqual(provider.repairs, 0)
