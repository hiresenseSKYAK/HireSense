import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database.connection import Base
from database.models import Job, JobAISummary
from services.career_ai import AIRequestBudget
from services.interview_settings import InterviewAISettings
from services.job_summary import JobSummaryService

SETTINGS = InterviewAISettings(api_key='test', model='gpt-4o-mini', light_model='gpt-4o-mini',
                               timeout_seconds=10, max_output_tokens=900, max_retries=0)
DESCRIPTION = (
    'Acme is hiring a Software Engineer Intern to join the payments team. You will build REST APIs in Python, '
    'write unit tests, and work with product managers to ship features to customers. The team owns the services '
    'that process card payments for small businesses. Requirements: currently pursuing a degree in Computer '
    'Science, experience with Python and SQL, and 1 year of programming coursework. Preferred: familiarity with '
    'AWS. Acme is an equal opportunity employer and considers all qualified applicants.'
)
GOOD = {
    'overview': 'A Software Engineer Intern on the payments team building services that process card payments.',
    'responsibilities': ['Build REST APIs in Python', 'Write unit tests'],
    'requirements': ['Pursuing a Computer Science degree', 'Python and SQL experience', '1 year of programming coursework'],
    'nice_to_have': ['AWS familiarity'],
}


def make_job(description=DESCRIPTION, job_id=7):
    return SimpleNamespace(id=job_id, job_title='Software Engineer Intern', company='Acme', job_description=description)


class JobSummaryTests(unittest.TestCase):
    def setUp(self):
        self.engine = engine = create_engine('sqlite://')
        Base.metadata.create_all(engine, tables=[Job.__table__, JobAISummary.__table__])
        self.db = sessionmaker(bind=engine)()
        self.client = Mock()
        self.client.complete.return_value = dict(GOOD)
        self.service = JobSummaryService(self.client, SETTINGS)

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def test_generates_once_then_serves_the_stored_summary(self):
        first = self.service.summarize(self.db, 1, make_job())
        self.assertEqual(first['source'], 'ai')
        self.assertFalse(first['cached'])
        self.assertEqual(first['requirements'], GOOD['requirements'])

        second = self.service.summarize(self.db, 2, make_job())
        self.assertTrue(second['cached'])
        self.assertEqual(second['overview'], GOOD['overview'])
        self.assertEqual(self.client.complete.call_count, 1)

    def test_changed_description_is_summarized_again(self):
        self.service.summarize(self.db, 1, make_job())
        self.service.summarize(self.db, 1, make_job(DESCRIPTION + ' The role is based in Dallas.'))
        self.assertEqual(self.client.complete.call_count, 2)

    def test_short_description_is_not_sent_to_the_model(self):
        result = self.service.summarize(self.db, 1, make_job('Build APIs with Python.'))
        self.assertEqual(result, {'source': 'unavailable', 'reason': 'short_description'})
        self.client.complete.assert_not_called()

    def test_invented_number_or_technology_is_rejected_and_never_retried(self):
        self.client.complete.return_value = dict(GOOD, requirements=['3 years of Kubernetes experience'])
        result = self.service.summarize(self.db, 1, make_job())
        self.assertEqual(result, {'source': 'unavailable', 'reason': 'evidence_validation'})
        self.assertEqual(self.db.get(JobAISummary, 7).summary_json, 'null')
        again = self.service.summarize(self.db, 2, make_job())
        self.assertEqual(again, {'source': 'unavailable', 'reason': 'no_summary'})
        self.assertEqual(self.client.complete.call_count, 1)

    def test_without_api_key_nothing_is_generated(self):
        result = JobSummaryService(None, SETTINGS).summarize(self.db, 1, make_job())
        self.assertEqual(result['reason'], 'provider_unconfigured')

    def test_hourly_budget_limits_new_summaries_but_not_stored_ones(self):
        service = JobSummaryService(self.client, SETTINGS, budget=AIRequestBudget(maximum=1))
        self.assertEqual(service.summarize(self.db, 1, make_job(job_id=1))['source'], 'ai')
        self.assertEqual(service.summarize(self.db, 1, make_job(job_id=2))['reason'], 'rate_limit')
        self.assertTrue(service.summarize(self.db, 1, make_job(job_id=1))['cached'])

    def test_temporary_provider_failure_is_retried_next_time(self):
        self.client.complete.side_effect = [TimeoutError('slow'), dict(GOOD)]
        self.assertEqual(self.service.summarize(self.db, 1, make_job()), {'source': 'unavailable', 'reason': 'timeout'})
        self.assertIsNone(self.db.get(JobAISummary, 7))
        self.assertEqual(self.service.summarize(self.db, 1, make_job())['source'], 'ai')


class BackfillScriptTests(unittest.TestCase):
    def test_summarizes_each_listed_job_and_reports_outcomes(self):
        from scripts import backfill_job_summaries as script
        engine = create_engine('sqlite://')
        Base.metadata.create_all(engine, tables=[Job.__table__, JobAISummary.__table__])
        session_factory = sessionmaker(bind=engine)
        with session_factory() as db:
            db.add_all([Job(id=1, job_title='Intern', company='Acme', job_description=DESCRIPTION),
                        Job(id=2, job_title='Intern', company='Acme', job_description=DESCRIPTION + ' More.')])
            db.commit()
        client = Mock()
        client.complete.side_effect = [dict(GOOD), dict(GOOD, overview='Invented 99% uptime.')]
        with patch.object(script, 'SessionLocal', session_factory),                 patch.object(script, 'engine', engine),                 patch.object(script, 'visible_job_ids_without_summary', return_value=[2, 1]),                 patch.object(script, 'build_job_summary_service', return_value=JobSummaryService(client, SETTINGS)),                 patch.object(script.time, 'sleep'):
            outcomes = script.backfill()
        engine.dispose()
        self.assertEqual(outcomes, {'summarized': 1, 'evidence_validation': 1})

    def test_dry_run_makes_no_model_calls(self):
        from scripts import backfill_job_summaries as script
        engine = create_engine('sqlite://')
        client = Mock()
        with patch.object(script, 'SessionLocal', sessionmaker(bind=engine)),                 patch.object(script, 'engine', engine),                 patch.object(script, 'visible_job_ids_without_summary', return_value=[1, 2, 3]),                 patch.object(script, 'build_job_summary_service', return_value=JobSummaryService(client, SETTINGS)):
            outcomes = script.backfill(dry_run=True)
        engine.dispose()
        self.assertEqual(outcomes, {})
        client.complete.assert_not_called()


if __name__ == '__main__':
    unittest.main()
