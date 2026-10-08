# AI Interview review and shared-provider handoff

## 1. Branch

Implementation stays on `feature/ai-interview`, based on the current repository
at `6baaeb4` and the earlier interview commit `d4a465f`. Main is unchanged.

## 2. Commit

The completion message identifies the exact final commit and pushed remote ref.
No merge or deployment is part of this work.

## 3. Files changed

Backend:
- `backend/api/interview.py`
- `backend/api/schemas.py`
- `backend/services/interview_context.py`
- `backend/services/interview_engine.py`
- `backend/services/interview_provider.py`
- `backend/services/interview_service.py`

Frontend:
- `frontend/src/api/interview.ts`
- `frontend/src/components/AIInterviewPanel.tsx`
- `frontend/src/features/autofill/ProfileReview.tsx`

Tests:
- `backend/tests/test_interview_api.py`
- `backend/tests/test_interview_engine.py`
- `frontend/src/api/interview.test.ts`
- `frontend/src/components/AIInterviewPanel.test.tsx`
- `frontend/src/features/autofill/experience.test.tsx`

Documentation: `docs/ai-interview.md`. Migrations: none; table layouts are unchanged.

The only change outside interview is a small type-only repair to ProfileReview:
its generic history editor retains concrete education/work types, text fields use
string-valued profile keys, and indexed values are narrowed before binding to
inputs. This fixes the 10 build errors already reproduced on main. It preserves
confirmation, review and autofill behavior. A focused history-editing regression
and the existing application-flow tests cover it. No extension code changed.

## 4. Architecture found

React/TypeScript/Vite job details supply the chosen database job ID and a locally
stored parsed resume to the interview panel. FastAPI uses opaque login tokens
stored in `user_sessions`, SQLAlchemy interview models, and MySQL JSON-in-TEXT
snapshots. Job details enforce active, internship/entry-level and geographic
eligibility. Resume parsing/scoring and the interview fallback are deterministic.
Applicant-profile confirmation and extension controls are separate and unchanged.
The latest main commit changes the site's theme to blue; existing tokens/styling
are preserved rather than reverting that teammate change to the older purple UI.

## 5. Backend changes

`POST /interview/start` creates an authenticated session. `POST
/interview/{id}/answer` validates ownership and question order, evaluates, optionally
replaces the next planned turn with a follow-up, saves feedback and advances
atomically. `GET /interview/{id}` recovers an owned current question or completed
result. Version 2 metadata records mode, selected count and total-turn semantics
in the existing safe resume JSON. The final debrief persists in the last response's
cached `_response`, with score/summary also in session columns. Answer excerpts
are not copied into the resume snapshot.

## 6. Frontend changes

Setup supports four modes and 3/5/8 total turns. States include starting, active,
drafting/dictation, submitting, feedback, follow-up, next question, completion,
restart, recovery and errors. Live status text, labels and disabled controls
support accessibility. Operation guards ignore late replies after changing jobs,
resumes or unmounting. A 45-second timeout returns an actionable retry error.
Failed submissions retain the draft. Runtime response checks reject malformed
success payloads before changing state. Terminal errors offer a new interview;
authentication errors also offer a sign-in link.

Recovery stores only the session ID in tab-scoped session storage, keyed by account,
job and a non-secret professional-context fingerprint. Server ownership is always
revalidated. Active recovery shows the current unanswered question; completed
recovery shows the saved debrief. Recovery after transient failure is retryable.

## 7. LLM/provider abstraction

`InterviewProvider` lives in `backend/services/interview_engine.py`. Its operations
are `generate(context)`, `evaluate(context, question, answer, history)`, and
`debrief(context, responses)`. `StructuredInterviewProvider` in
`backend/services/interview_provider.py` supplies fixed system instructions,
separately serialized untrusted user data, JSON schemas and a 15-second deadline
to a shared client. There is no vendor SDK or provider credential in this feature.

Anas can register:

```python
from services.interview_provider import StructuredInterviewProvider
app.state.interview_provider = StructuredInterviewProvider(shared_client)
```

The client implements:

```python
complete(*, messages: list[dict], schema: dict, timeout: float) -> dict | str
```

It must be thread-safe and enforce the deadline across transport and any retries.
Answer transactions hold a write lock during evaluation/debrief, so bounded
transport is mandatory. No configured provider means deterministic fallback.
The engine parses JSON strings or dictionaries and validates every model output.

## 8. Job-context behavior

Uses server-loaded title, company, location, job type, experience level, work style,
description and structured skills. Structured description sections include about,
description, responsibilities, requirements and qualifications when present.
Description is bounded to 12,000 characters, metadata to 500 characters per field,
and skills to 50 entries of 100 characters. Very large Unicode descriptions are
shortened further, with skills trimmed if necessary, to keep serialized snapshots
within 56 KB. Missing fields stay empty or use
neutral question wording, never invented technologies or requirements.
Start applies the same active/experience/geography rules as job details.

## 9. Resume-context behavior

Career-only DTO: skills, education, experience/project/leadership entries and
bullets, with legacy professional sections used only when structured sections are
absent. It uses the parsed resume; it does not bypass autofill confirmation or
import sensitive applicant-profile fields. Name, email, phone, address, postal
code, demographics, authorization and arbitrary extra fields are not DTO fields.
The frontend builds an allowlist; the backend independently bounds/sanitizes it.
Email/phone/street-address patterns and labeled sensitive lines are removed or
redacted. Unsafe controls are normalized. Professional request JSON is capped at
32 KB before storage. This is minimization, not guaranteed anonymization of
arbitrary free-form prose.

## 10. Question generation

Behavioral, Technical, Mixed and Role-specific; 3, 5 or 8 total turns. Fallback
uses actual role, skill matches/gaps and professional experience/project labels.
Mixed questions carry individual types. Gaps are framed as learning opportunities.
Provider questions require exact count, supported mode, bounded strings/lists,
unique server IDs and lexical near-duplicate checks. Structured output does not
prove factual accuracy; model/provider quality remains a review responsibility.

## 11. Evaluation behavior

Four explicit 25-point dimensions total 100: Relevance, Structure, Specificity,
Impact. Behavioral feedback emphasizes ownership, specific examples, outcomes
and reflection. Technical Structure measures reasoning/assumptions; Specificity
measures technical detail; Impact also recognizes testing/validation. Fallback
uses disclosed heuristics and never claims to verify technical correctness.
Provider dimensions must be unique and sum to the score. Evidence is required
and must be a literal excerpt of the current answer. The server derives benchmark.
Scores are practice feedback, not hiring probabilities.

## 12. Follow-up behavior

An unresolved useful claim may trigger a probe; fallback quotes a short actual
answer excerpt and asks about the weakest signal. One-word replies do not
arbitrarily trigger probes, and strong fallback answers do not need them. Model
failure continues through fallback feedback or the next planned question.
A follow-up replaces the next planned turn, records `parent_question_id`, cannot
chain from another follow-up, avoids existing prompts, and leaves the final turn
planned. Maximum one follow-up for 3/5 turns, two for 8. Total never grows.

## 13. Final debrief

Average score/dimensions; demonstrated strengths; next steps; technical and
communication signals; strongest/weakest question and actual answer excerpts;
practice questions; specificity needs; and resume entries explicitly mentioned
in recorded answers. The model may write validated prose but cannot override
scores or server-grounded references. Display excerpts are bounded; complete
answers remain in their response records. The completed cached result is returned
again through owned retrieval or an identical final-answer retry.

## 14. Session and security changes

Start, answer and retrieval require valid, unexpired bearer authentication.
Every session operation requires a matching non-null owner. Invalid tokens return
401; missing or wrong-owner sessions return non-enumerating 404. Legacy sessions
require restart (owned version 1 returns 410; null-owner returns 404). Interviews
expire after 24 hours. Clients cannot choose owners or authoritative job snapshots.

A conditional index update acquires a transactional lock. Responses, index,
follow-up replacement and completion commit together; exceptions roll back.
Identical committed answer retries replay the saved response. Changed/stale IDs,
completed-session changes and racing requests return 409. A racing identical
request may need one retry after the first transaction commits. No extra database
constraint or production migration is required for this API progression strategy.

## 15. Fallback and error handling

No provider, absent credentials, timeout, rate limit, network errors, malformed
JSON, empty results or schema/semantic failures use deterministic fallback per
operation. Safe logs identify only operation and exception class. Prompts,
credentials and raw provider errors are not logged by interview code.
`QuestionSet`, `Evaluation` and `Debrief` in the engine are authoritative schemas;
use their `model_json_schema()` outputs. Questions are limited to 24 KB of JSON;
evaluations/debrief prose to 6 KB. Context cannot supply system instructions or
tool calls. Fixed policy says not to obey embedded instructions or request secrets.
Boundary tests confirm injection strings stay in user data; this is not a claim
that every future model is immune to prompt injection.

## 16. Tests added or updated

API tests cover authentication/expiry/ownership, unavailable jobs, PII snapshots,
mode/count, answer limits, retry replay, rollback, total-turn/follow-up limits,
completion/retrieval, legacy records, restart and concurrent transactions.
Engine tests cover bounded contexts, modes, requirements, JSON parsing, invalid
outputs, duplicate questions, provider failures, evidence, rubrics, follow-ups,
debrief score integrity and fixed prompt/data separation. Frontend API tests cover
safe requests, authentication, deadlines, runtime validation and retrieval. Panel
tests cover all setup modes/counts, loading/errors/retry, missing resume, drafting,
feedback/follow-up/completion, stale requests, double submits, dictation support,
terminal errors and active/completed/transient recovery. Autofill history coverage
checks typed fields and clearing/disabling the end date for a current job.

## 17. Exact test results

A temporary Python 3.12 environment contains the web requirements plus test and
crawler utility dependencies; tests use SQLite/fakes, never API keys or production
connections. No dependency manifest changed. From repository root:

```sh
PYTHONWARNINGS=ignore PYTHONPATH=backend /private/tmp/hiresense-interview-venv/bin/python -m unittest discover -s backend/tests -p 'test_interview*.py' -q
# 31 tests, OK
PYTHONWARNINGS=ignore PYTHONPATH=backend /private/tmp/hiresense-interview-venv/bin/python -m unittest discover -s backend/tests -p 'test_*.py' -q
# 113 tests, OK
```

From `frontend/`:

```sh
npm ci
npm test -- --run
npm run build
```

`npm ci` succeeded; frontend tests: **211 passed across 19 files**. Production
build: TypeScript passed, Vite transformed 86 modules and produced the static build. Existing expected error-path
logs and library deprecation/future-flag notices are not test failures. No extension
code changed, so an extension rebuild was not required.

## 18. Production build result

`npm run build` runs TypeScript then Vite. It passes after the narrow type-only
ProfileReview repair described above. No tests or compiler checks were weakened.

## 19. Required environment variables

No new variables. `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` configure
backend storage; `CORS_ORIGINS` configures allowed frontend origins;
`VITE_API_BASE_URL` is the frontend backend URL. Existing crawler/model and
extension variables are unchanged. Provider variables will be defined by Anas;
provider secrets must remain backend-only and never appear in `VITE_*`.

## 20. What Anas still needs to supply

Shared completion client/adapter, final provider/model, server-only credentials,
production configuration, enforced transport deadlines and safe retries, provider
accuracy/latency/injection evaluations, and review/merge approval. The fixed prompt
adapter, schemas and deterministic experience are ready for that client.

## 21. Known limitations

No real LLM or live MySQL was exercised; concurrency tests use separate SQLite
connections. Fallback measures answer signals rather than technical correctness.
Lexical repetition checks do not recognize every semantic paraphrase. Sanitization
cannot identify all personal details in arbitrary career prose. Existing historical
snapshots are not purged automatically; review retention/cleanup before rollout.
Drafts remain in memory and are lost on refresh; server questions/debriefs recover
within the browser tab. Rate limits, cost controls, retention and deletion policy
remain hosting/provider decisions. No public deployment or manual browser visual
certification is claimed.

## 22. Main-branch confirmation

Nothing committed directly to main; nothing pushed to main; no merge performed.

## 23. Deployment confirmation

Nothing deployed. Production configuration and credentials were not changed.
