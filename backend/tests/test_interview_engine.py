import unittest
from unittest.mock import Mock

from services.interview_engine import InterviewEngine, interview_context

JOB = {'job_title': 'Backend Engineer', 'company': 'Acme', 'skills': ['Python', 'SQL'], 'job_description': 'Build reliable data services using Python and SQL.'}
RESUME = {'name': 'Private Name', 'email': 'private@example.com', 'phone': '555', 'skills': ['Python'], 'project_entries': [{'title': 'Resume Parser', 'bullets': ['Reduced review time by 30%.']}], 'experience_entries': []}


class EngineTests(unittest.TestCase):
    def test_modes_and_counts_have_unique_server_ids_and_context(self):
        for mode in ('mixed', 'behavioral', 'technical', 'role_specific'):
            for count in (3, 5, 8):
                questions = InterviewEngine().questions(JOB, RESUME, mode, count)
                self.assertEqual(len(questions), count)
                self.assertEqual(len({q['question_id'] for q in questions}), count)
                self.assertTrue(all(q['mode'] == mode and q['source'] == 'fallback' for q in questions))
        questions = InterviewEngine().questions(JOB, RESUME)
        self.assertIn('Python', questions[1]['prompt'])
        self.assertIn('SQL', questions[3]['prompt'])
        self.assertIn('Resume Parser', questions[4]['prompt'])

    def test_context_is_bounded_and_excludes_contact_and_server_metadata(self):
        context = interview_context(JOB, dict(RESUME, _interview={'token_hash': 'secret'}), 'mixed', 5)
        self.assertNotIn('private@example.com', str(context))
        self.assertNotIn('Private Name', str(context))
        self.assertNotIn('token_hash', str(context))
        self.assertIn('Reduced review time', str(context))
        self.assertIn('reliable data services', str(context))

    def test_provider_questions_use_validated_payload_and_server_ids(self):
        provider = Mock()
        provider.generate.return_value = {'questions': [{'focus_area': 'Technical', 'prompt': f'Explain decision number {i} in your Python project.', 'question_type': 'technical'} for i in range(3)]}
        questions = InterviewEngine(provider).questions(JOB, RESUME, 'technical', 3)
        self.assertTrue(all(q['source'] == 'ai' for q in questions))
        self.assertEqual(questions[0]['question_id'], 'q1')
        self.assertEqual(provider.generate.call_args.args[0]['mode'], 'technical')

    def test_bad_provider_outputs_and_exceptions_fall_back(self):
        for value in ({}, {'questions': []}, {'questions': [{'prompt': 'bad'}]}, {'questions': [{'focus_area': 'X', 'prompt': 'Explain your choice.'}] * 4}):
            provider = Mock()
            provider.generate.return_value = value
            self.assertEqual(InterviewEngine(provider).questions(JOB, RESUME)[0]['source'], 'fallback')
        provider = Mock()
        provider.generate.side_effect = TimeoutError('sensitive provider payload')
        with self.assertLogs('services.interview_engine', level='WARNING') as logs:
            self.assertEqual(InterviewEngine(provider).questions(JOB, RESUME)[0]['source'], 'fallback')
        self.assertNotIn('sensitive provider payload', str(logs.output))

    def test_ai_scores_and_evidence_must_be_consistent(self):
        provider = Mock()
        valid = {'score': 40, 'summary': 'Add a result.', 'strengths': ['Specific tool.'], 'improvements': ['Add outcome.'], 'dimensions': [{'label': label, 'score': 10} for label in ('Relevance', 'Structure', 'Specificity', 'Impact')], 'evidence': ['Python'], 'follow_up': 'What changed after you built the Python parser?'}
        provider.evaluate.return_value = valid
        engine = InterviewEngine(provider)
        question = engine.questions(JOB, RESUME)[0]
        context = interview_context(JOB, RESUME, 'mixed', 5)
        result = engine.feedback(context, question, 'I used Python.', [])
        self.assertEqual(result['source'], 'ai')
        self.assertEqual(result['benchmark'], 'Needs work')
        provider.evaluate.return_value = dict(valid, evidence=['invented result'])
        self.assertEqual(engine.feedback(context, question, 'I used Python.', [])['source'], 'fallback')
        provider.evaluate.return_value = dict(valid, score=99)
        self.assertEqual(engine.feedback(context, question, 'I used Python.', [])['source'], 'fallback')

    def test_final_has_grounded_questions_and_server_average(self):
        engine = InterviewEngine()
        q = engine.questions(JOB, RESUME)[0]
        f = engine.feedback(interview_context(JOB, RESUME, 'mixed', 5), q, 'Python', [])
        responses = [{'question_prompt': q['prompt'], 'score': f['score'], 'feedback': f}]
        result = engine.final(interview_context(JOB, RESUME, 'mixed', 5), responses)
        self.assertEqual(result['final_score'], f['score'])
        self.assertEqual(result['resume_evidence'], ['Resume Parser'])
        self.assertEqual(result['practice_questions'], [q['prompt']])

    def test_debrief_cannot_override_server_scores(self):
        provider = Mock()
        context = interview_context(JOB, RESUME, 'mixed', 3)
        responses = [{'question_prompt': 'Explain your project.', 'score': 40, 'feedback': {}}]
        provider.debrief.return_value = {'overall_summary': 'Practice clearer examples.', 'top_strengths': [], 'next_steps': ['Explain your decisions.']}
        result = InterviewEngine(provider).final(context, responses)
        self.assertEqual(result['source'], 'ai')
        self.assertEqual(result['final_score'], 40)
        provider.debrief.return_value['final_score'] = 100
        result = InterviewEngine(provider).final(context, responses)
        self.assertEqual(result['source'], 'fallback')
        self.assertEqual(result['final_score'], 40)
