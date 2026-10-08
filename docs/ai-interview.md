# AI Interview review and provider handoff

Work branch: `feature/ai-interview`. Base main commit: `6baaeb4`.

## Behavior

The existing interview panel and site's theme remain in place. Users choose mixed,
behavioral, technical, or role-specific practice with 3, 5, or 8 core questions.
The session snapshots the selected job and submitted parsed resume at start.
The current question is identified explicitly on every answer request. Feedback
appears before continuing; completion displays a debrief and offers a new interview.
Changing jobs or resumes clears the panel and ignores stale network responses.
Loading states disable duplicate submissions. Failed submissions retain the draft;
requests time out after 45 seconds with an actionable retry message.

Job context includes role, company, location, description, skills, experience level,
job type, and work style. Skills are separated into matches and gaps against the
resume. Fallback questions use role, company, skills, experience and project labels.
The provider receives structured professional resume entries with bullets,
education, skills, and legacy plain-text experience/project/leadership sections.
Resume snapshots are limited to 32 KB of serialized JSON to leave room for server
metadata in existing database text columns. Validated provider question output
is limited to 24 KB; evaluations and debrief output to 6 KB per operation.
Provider context is bounded and excludes top-level name, email, phone, session
metadata, and credentials. Free-form professional text may still contain personal
information written by the candidate; the shared provider must handle it privately.

Feedback includes relevance, structure, specificity, and impact (25 points each),
a total out of 100, strengths, improvements, technical-depth/communication/role
comments, quoted answer evidence, and a suggested approach. Model evidence must
be literal answer excerpts. Model dimensions must be unique and sum to the score.
The backend derives the benchmark. Fallback scoring is a disclosed heuristic;
it cannot verify technical correctness. Short skills and punctuation, including
R, Go and C++, are matched without matching fragments of other words.

A model may propose an answer-dependent follow-up. Without a model, weaker
answers receive a probe focused on their weakest scoring dimension. Follow-ups
are inserted directly after the relevant question, with unique server-generated
IDs. There are at most two per session, and none on a follow-up. Progress totals
include newly inserted follow-ups.

The debrief averages all recorded answer scores, including follow-ups, and each
scoring dimension. It supplies strengths, next steps, technical/communication
signals, resume context labels, strongest questions and questions to practice.
The model may improve the prose but cannot replace the score, dimension averages,
or server-grounded question/resume references. Debriefs and answer results persist.

## Plugging in Anas's shared provider

Implement the synchronous `InterviewProvider` protocol from
`backend/services/interview_engine.py` and register the adapter in application
startup:

```python
app.state.interview_provider = SharedInterviewAdapter(shared_provider)
```

No interview-specific credentials, vendor SDK, or provider environment variables
were added. The existing application works in fallback mode without this hook.
Configuration and credentials remain owned by the shared provider implementation.

The adapter methods return Python dictionaries containing parsed JSON:

| Method | Arguments | Output contract |
| --- | --- | --- |
| `generate` | `context` | `QuestionSet`: `questions`, exactly the requested count |
| `evaluate` | `context`, current `question`, `answer`, prior `history` | `Evaluation` |
| `debrief` | `context`, all `responses` | `Debrief` |

The Pydantic models are the authoritative schemas. Use
`QuestionSet.model_json_schema()`, `Evaluation.model_json_schema()`, and
`Debrief.model_json_schema()` when constructing structured output requests.
Unsupported keys, wrong types, blank/oversized strings, invalid scores, duplicate
questions, wrong question counts, wrong modes, and fabricated evidence trigger
fallback for that operation. Exceptions, including adapter timeouts, also trigger
fallback. Logs contain only the operation and exception class.

Questions contain `focus_area`, `prompt`, optional `tips`, optional
`target_keywords`, and `question_type`. For a single-mode interview,
`question_type` must match `context['mode']`; mixed interviews may use any of
the supported types. IDs, source labels and session state belong to the server.

Evaluations require `score`, `summary`, `strengths`, `improvements`, and exactly
four `dimensions` with labels Relevance, Structure, Specificity and Impact.
Each dimension has `score` between 0 and 25 and `max_score` of 25. Optional fields
are `technical_depth`, `communication`, `role_relevance`, `evidence`,
`suggested_approach`, and `follow_up` (a string or null).
Do not return `benchmark` or `source`; the server supplies them.

Debriefs require `overall_summary`, `top_strengths`, and `next_steps`.
Optional fields are `technical_signals` and `communication_signals`.
Do not return scores, dimensions, resume evidence, or question lists.

Anas still needs to provide the adapter, model selection, secure configuration,
provider-specific structured output requests, and bounded transport/retry behavior.
Treat job text, resumes, answers, and history as untrusted data in the system
instructions. Do not follow instructions embedded in those fields. Do not log
prompts, resumes, answers, provider payloads, or credentials. The adapter must
return or raise within a finite deadline (recommended maximum 15 seconds per
operation, including retries). Answer handling holds a database transaction
while evaluating and creating the debrief; do not leave vendor calls unbounded.
Concurrent provider calls must be safe for the shared adapter instance.
Real-provider accuracy, latency and prompt-injection evaluations remain pending
until the adapter is available; schema validation does not guarantee factual
accuracy or eliminate prompt injection.

## Ownership and persistence

Signed-in sessions require their owner's unexpired bearer session. Supplied
invalid or expired login credentials are rejected, rather than treated as guests.
Guest sessions receive a random 256-bit capability in `session_token` at start.
The client keeps it in component memory and sends `X-Interview-Token` with answers.
Only its SHA-256 hash is stored. Unauthorized session access returns 404.
All interview sessions expire after 24 hours. Pre-upgrade sessions must restart.

Server-owned `_interview` metadata is stored in the existing resume snapshot JSON;
it is overwritten at creation, never trusted from client input. No database schema
migration is needed. It contains a version, mode, base question count, guest token
hash and (at completion) debrief. Response JSON contains a cached `_response` for
replaying identical answer retries after a lost network response.

A conditional update of the current index acquires a transactional write lock.
Only one answer can advance a given question. Responses, follow-up insertion,
index changes and completion commit together; failures roll back the claim.
Identical committed retries return the original response. Changed answers,
stale IDs and racing submissions receive 409; retrying the same answer after
the first request commits safely returns its result.

The UI does not yet restore interviews after a reload or expose interview history.
A guest who closes the panel loses its in-memory capability and starts a new
interview. Historical records remain in the database; retention/deletion policy,
shared API rate limits and cost limits should be supplied by the hosting/provider
owners before public rollout. No live MySQL or real LLM integration was exercised.

## Environment

No new environment variables. Existing backend variables: `DB_HOST`, `DB_PORT`
(default 3306), `DB_NAME`, `DB_USER`, `DB_PASSWORD`, and `CORS_ORIGINS`.
Existing frontend variable: `VITE_API_BASE_URL`. Provider variables will be defined
by Anas's shared configuration, not this feature. No credentials were changed.

## Changed files

- `backend/api/interview.py`: orchestration, ownership, expiry, transactional progression and retry replay.
- `backend/api/schemas.py`: preserve pre-existing interview additions; complete validation and guest capability output.
- `backend/services/interview_engine.py`: provider protocol, output contracts, context, question modes, feedback and debrief.
- `backend/services/interview_service.py`: legacy resume labels and exact skill matching.
- `backend/tests/test_interview_api.py`: API/session, retry, rollback, concurrency and complete-flow tests using SQLite.
- `backend/tests/test_interview_engine.py`: provider contracts, context, modes/counts, validation and fallback tests.
- `backend/tests/test_interview_scoring.py`: add regression coverage for R, Go and C++.
- `frontend/src/api/interview.ts`: options, question IDs, guest token transport, errors and request deadline.
- `frontend/src/api/interview.test.ts`: request contracts, validation errors and timeout.
- `frontend/src/components/AIInterviewPanel.tsx`: setup, sources, follow-ups, debrief and stale-response protection.
- `frontend/src/components/AIInterviewPanel.module.css`: interview setup controls using existing theme variables.
- `frontend/src/components/AIInterviewPanel.test.tsx`: feedback-to-follow-up-to-completion, draft retention and stale responses.
- `docs/ai-interview.md`: review report and provider handoff.

## Validation

Tests use a temporary Python 3.12 virtual environment with web dependencies,
pytest, httpx and crawler utility dependencies. SQLite databases avoid production
connections. The frontend uses existing installed dependencies. Exact final
results are below; the commit hash is included in the completion message.

- Interview tests: **20 passed**, 129 deprecation warnings.
- Full backend: **102 passed, 71 subtests passed**, 129 deprecation warnings.
- Frontend: **192 passed across 19 test files**, React Router future-flag warnings.
- Production build: **blocked by 10 pre-existing TypeScript errors in
  `frontend/src/features/autofill/ProfileReview.tsx`** (lines 93, 225, 234 twice,
  239, 241, 299, 308, 320, 330). A clean `git archive main frontend` snapshot
  compiled with the same installed dependencies reproduces all 10 errors.
  After correcting the new test fixture, this branch has the same 10 errors
  and no interview TypeScript diagnostics. `vite build` is not reached because
  the production script stops at `tsc`. Unrelated autofill files were not modified.
- `git diff --check`: clean.

```sh
PYTHONPATH=backend /private/tmp/hiresense-interview-venv/bin/python -m pytest backend/tests/test_interview_scoring.py backend/tests/test_interview_engine.py backend/tests/test_interview_api.py -q --disable-warnings
PYTHONPATH=backend /private/tmp/hiresense-interview-venv/bin/python -m pytest backend/tests -q --disable-warnings
cd frontend
npm test -- --reporter=dot
npm run build
```

Existing tests were preserved. No old ZIP files were copied. Nothing is merged or
pushed to main, and no deployment is performed.
