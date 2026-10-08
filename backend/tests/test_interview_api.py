import json
import os
import unittest
from datetime import datetime, timedelta
from unittest.mock import patch

for key, value in {'DB_HOST': 'test.invalid', 'DB_PORT': '3306', 'DB_NAME': 'testdb', 'DB_USER': 'testuser', 'DB_PASSWORD': 'testpassword'}.items():
    os.environ.setdefault(key, value)

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from api.interview import router
from database.connection import Base, get_db
from database.models import InterviewResponse, InterviewSession, Job, User, UserSession


class InterviewApiTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine)
        with self.sessions() as db:
            db.add(Job(id=1, job_title='Backend Engineer', company='Acme', skills='["Python", "SQL"]', location='Denton, TX', experience_level='Entry level', active=True))
            db.add_all([User(id=i, username=f'user{i}', email=f'u{i}@example.com', password_hash='unused') for i in (1, 2)])
            db.add_all([UserSession(user_id=i, token=f'user{i}', expires_at=datetime.utcnow() + timedelta(hours=1)) for i in (1, 2)])
            db.add(UserSession(user_id=1, token='expired', expires_at=datetime.utcnow() - timedelta(hours=1)))
            db.commit()
        app = FastAPI()
        app.include_router(router)
        def database():
            with self.sessions() as db:
                yield db
        app.dependency_overrides[get_db] = database
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()
        self.engine.dispose()

    def start(self, headers=None, **options):
        return self.client.post('/interview/start', headers=headers if headers is not None else {'Authorization': 'Bearer user1'}, json={'job_id': 1, 'resume_data': {'skills': ['Python'], 'project_entries': [{'title': 'Parser', 'bullets': ['Parsed PDFs.']}]}, **options})

    def answer(self, q, token='user1', answer='I built a Python parser to help my team.', headers=None):
        return self.client.post(f"/interview/{q['session_id']}/answer", json={'answer': answer, 'question_id': q['question_id']}, headers=headers if headers is not None else ({'Authorization': f'Bearer {token}'} if token else {}))

    def test_required_authentication_and_question_validation(self):
        self.assertEqual(self.start(headers={}).status_code, 401)
        q = self.start().json()
        self.assertNotIn('session_token', q)
        self.assertEqual(self.answer(q, token=None).status_code, 401)
        self.assertEqual(self.answer(q, 'wrong').status_code, 401)
        self.assertEqual(self.answer(dict(q, question_id='q9')).status_code, 409)
        self.assertEqual(self.answer(q, answer='   ').status_code, 422)
        self.assertEqual(self.answer(q, answer='x' * 5001).status_code, 422)
        result = self.answer(q)
        self.assertEqual(result.status_code, 200)
        self.assertTrue(result.json()['next_question']['is_follow_up'])
        self.assertEqual(result.json()['next_question']['parent_question_id'], q['question_id'])

    def test_ownership_and_expired_login(self):
        for token in ('expired', 'bad'):
            self.assertEqual(self.start(headers={'Authorization': f'Bearer {token}'}).status_code, 401)
        q = self.start(headers={'Authorization': 'Bearer user1'}).json()
        self.assertNotIn('session_token', q)
        self.assertEqual(self.answer(q, headers={'Authorization': 'Bearer user2'}).status_code, 404)
        self.assertEqual(self.answer(q, token=None).status_code, 401)
        self.assertEqual(self.answer(q, headers={'Authorization': 'Bearer expired'}).status_code, 401)
        self.assertEqual(self.answer(q, headers={'Authorization': 'Bearer user1'}).status_code, 200)

    def test_retries_replay_without_duplicate_or_advancement(self):
        q = self.start().json()
        token = 'user1'
        first = self.answer(q, token).json()
        self.assertEqual(self.answer(q, token).json(), first)
        self.assertEqual(self.answer(q, token, 'Changed answer').status_code, 409)
        with self.sessions() as db:
            self.assertEqual(db.query(InterviewResponse).count(), 1)
            self.assertEqual(db.get(InterviewSession, q['session_id']).current_question_index, 1)

    def test_complete_flow_bounds_followups_and_persists_debrief(self):
        q = self.start(question_count=3).json()
        token = 'user1'
        answered = 0
        while True:
            result = self.answer(q, token)
            self.assertEqual(result.status_code, 200, result.text)
            data = result.json()
            answered += 1
            self.assertLessEqual(answered, 3)
            if data['is_complete']:
                self.assertTrue(data['final_result']['practice_questions'])
                self.assertEqual(self.answer(q, token).json(), data)
                break
            q = data['next_question']
        self.assertEqual(answered, 3)
        with self.sessions() as db:
            session = db.get(InterviewSession, q['session_id'])
            self.assertEqual(session.status, 'completed')
            self.assertEqual(session.total_questions, 3)
            latest = db.query(InterviewResponse).filter(InterviewResponse.session_id == session.id).order_by(InterviewResponse.question_index.desc()).first()
            self.assertEqual(json.loads(latest.feedback_json)['_response']['final_result'], data['final_result'])
            self.assertNotIn('final_result', json.loads(session.resume_snapshot)['_interview'])

    def test_expired_session_and_empty_resume(self):
        q = self.start().json()
        with self.sessions() as db:
            db.get(InterviewSession, q['session_id']).created_at = datetime.utcnow() - timedelta(days=2)
            db.commit()
        self.assertEqual(self.answer(q, 'user1').status_code, 410)
        self.assertEqual(self.client.post('/interview/start', headers={'Authorization': 'Bearer user1'}, json={'job_id': 1, 'resume_data': {}}).status_code, 422)
        self.assertEqual(self.start(mode='invalid').status_code, 422)
        self.assertEqual(self.start(question_count=100).status_code, 422)
        self.assertEqual(self.start(question_count=3.0).status_code, 422)
        self.assertEqual(self.client.post('/interview/start', headers={'Authorization': 'Bearer user1'}, json={'job_id': 1, 'resume_data': {'skills': ['Python'], 'experience': ['x' * 33000]}}).status_code, 422)

    def test_failed_operation_rolls_back_claim(self):
        q = self.start().json()
        with patch('services.interview_engine.InterviewEngine.feedback', side_effect=RuntimeError('test')):
            with self.assertRaises(RuntimeError):
                self.answer(q, 'user1')
        with self.sessions() as db:
            self.assertEqual(db.get(InterviewSession, q['session_id']).current_question_index, 0)
            self.assertEqual(db.query(InterviewResponse).count(), 0)
        self.assertEqual(self.answer(q, 'user1').status_code, 200)

    def test_concurrent_submissions_cannot_skip_a_question(self):
        # A file-backed database gives each request a separate connection/transaction.
        import tempfile
        from concurrent.futures import ThreadPoolExecutor
        from threading import Event
        from services.interview_engine import InterviewEngine
        with tempfile.TemporaryDirectory() as directory:
            race_engine = create_engine(f'sqlite:///{directory}/race.db', connect_args={'check_same_thread': False})
            Base.metadata.create_all(race_engine)
            old_sessions = self.sessions
            self.sessions = sessionmaker(bind=race_engine)
            try:
                with self.sessions() as db:
                    db.add(Job(id=1, job_title='Engineer', skills='["Python"]', location='Denton, TX', experience_level='Entry level', active=True))
                    db.add(User(id=1, username='user1', email='u1@example.com', password_hash='unused'))
                    db.add(UserSession(user_id=1, token='user1', expires_at=datetime.utcnow() + timedelta(hours=1)))
                    db.commit()
                q = self.start().json()
                entered, release, second_entered = Event(), Event(), Event()
                original = InterviewEngine.feedback
                def pause(engine, *args):
                    entered.set()
                    if not release.wait(5):
                        raise RuntimeError('Concurrency test timed out')
                    return original(engine, *args)
                from api.interview import _authorize
                def observe_authorization(*args):
                    _authorize(*args)
                    if entered.is_set():
                        second_entered.set()
                with patch.object(InterviewEngine, 'feedback', pause), patch('api.interview._authorize', side_effect=observe_authorization):
                    with ThreadPoolExecutor(max_workers=2) as pool:
                        first = pool.submit(self.answer, q, 'user1')
                        self.assertTrue(entered.wait(5))
                        second = pool.submit(self.answer, q, 'user1')
                        self.assertTrue(second_entered.wait(5))
                        release.set()
                        results = [first.result(timeout=5), second.result(timeout=5)]
                self.assertEqual(results[0].status_code, 200)
                self.assertIn(results[1].status_code, (200, 409))
                with self.sessions() as db:
                    self.assertEqual(db.query(InterviewResponse).count(), 1)
                    self.assertEqual(db.get(InterviewSession, q['session_id']).current_question_index, 1)
            finally:
                self.sessions = old_sessions
                race_engine.dispose()

    def test_job_availability_matches_detail_policy(self):
        with self.sessions() as db:
            db.add_all([
                Job(id=2, job_title='Engineer', active=False, experience_level='Entry level', location='Denton, TX'),
                Job(id=3, job_title='Engineer', active=True, experience_level='Senior', location='Denton, TX'),
                Job(id=4, job_title='Engineer', active=True, experience_level='Entry level', location='Seattle, WA'),
            ])
            db.commit()
        for job_id in (2, 3, 4, 999):
            result = self.client.post('/interview/start', headers={'Authorization': 'Bearer user1'}, json={'job_id': job_id, 'resume_data': {'skills': ['Python']}})
            self.assertEqual(result.status_code, 404)

    def test_safe_snapshot_omits_pii_and_ignores_client_metadata(self):
        payload = {'skills': ['Python'], 'name': 'Private Person', 'email': 'private@example.com', 'phone': '5551234567', 'address': '123 Main Street', '_interview': {'version': 2}, 'experience_entries': [{'title': 'Developer', 'bullets': ['Built Python tooling. Email: private@example.com; phone 555-123-4567.']} ]}
        result = self.client.post('/interview/start', headers={'Authorization': 'Bearer user1'}, json={'job_id': 1, 'resume_data': payload, 'user_id': 2, 'job_snapshot': {'company': 'forged'}})
        self.assertEqual(result.status_code, 200)
        with self.sessions() as db:
            session = db.get(InterviewSession, result.json()['session_id'])
            for sensitive in ('Private Person', 'private@example.com', '5551234567', '555-123-4567', '123 Main Street'):
                self.assertNotIn(sensitive, session.resume_snapshot)
            self.assertEqual(session.user_id, 1)
            self.assertNotIn('forged', session.job_snapshot)

    def test_recovery_and_debrief_enforce_auth_and_ownership(self):
        q = self.start(question_count=3).json()
        url = f"/interview/{q['session_id']}"
        self.assertEqual(self.client.get(url).status_code, 401)
        self.assertEqual(self.client.get(url, headers={'Authorization': 'Bearer bad'}).status_code, 401)
        self.assertEqual(self.client.get(url, headers={'Authorization': 'Bearer expired'}).status_code, 401)
        self.assertEqual(self.client.get(url, headers={'Authorization': 'Bearer user2'}).status_code, 404)
        owner = {'Authorization': 'Bearer user1'}
        state = self.client.get(url, headers=owner).json()
        self.assertEqual(state['current_question']['question_id'], q['question_id'])
        while True:
            data = self.answer(q).json()
            if data['is_complete']:
                break
            q = data['next_question']
        state = self.client.get(url, headers=owner).json()
        self.assertEqual(state['status'], 'completed')
        self.assertEqual(state['last_response']['final_result'], data['final_result'])
        self.assertEqual(self.answer(dict(q, question_id='q999')).status_code, 409)
        self.assertEqual(self.client.get(url, headers={'Authorization': 'Bearer user2'}).status_code, 404)

    def test_legacy_null_owned_invalid_and_new_session(self):
        q = self.start().json()
        another = self.start().json()
        self.assertNotEqual(q['session_id'], another['session_id'])
        with self.sessions() as db:
            db.get(InterviewSession, q['session_id']).user_id = None
            db.get(InterviewSession, another['session_id']).resume_snapshot = '{}'
            db.commit()
        self.assertEqual(self.answer(q).status_code, 404)
        self.assertEqual(self.answer(another).status_code, 410)
        self.assertEqual(self.answer(dict(q, session_id=9999)).status_code, 404)

    def test_selected_count_is_total_with_or_without_followups(self):
        for count in (3, 5, 8):
            for answer in ('Python', 'I built a Python parser to help my team.'):
                q = self.start(question_count=count).json()
                probes = 0
                for turn in range(count):
                    probes += q['is_follow_up']
                    data = self.answer(q, answer=answer).json()
                    self.assertEqual(data['is_complete'], turn == count - 1)
                    if not data['is_complete']:
                        q = data['next_question']
                        self.assertEqual(q['total_questions'], count)
                self.assertLessEqual(probes, 2)
                if answer == 'Python':
                    self.assertEqual(probes, 0)

    def test_unicode_job_snapshot_stays_within_text_storage_budget(self):
        with self.sessions() as db:
            db.get(Job, 1).job_description = '🚀' * 12000
            db.get(Job, 1).skills = json.dumps(['🚀' * 97 + str(i) for i in range(50)], ensure_ascii=False)
            db.commit()
        q = self.start().json()
        with self.sessions() as db:
            self.assertLessEqual(len(db.get(InterviewSession, q['session_id']).job_snapshot.encode('utf-8')), 56000)
