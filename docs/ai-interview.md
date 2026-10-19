# HireSense AI Interview

The AI Interview is an authenticated, job-aware and resume-aware interview coaching flow. A configured OpenAI provider is the primary coaching path. Every provider operation has an independent deterministic fallback, so a missing key or provider outage does not prevent practice.

## Architecture

```text
React job detail
  -> authenticated FastAPI interview route
  -> authoritative job + minimized resume context
  -> InterviewEngine
       -> StructuredInterviewProvider
            -> OpenAI Responses API + Pydantic Structured Outputs
       -> deterministic fallback on any unavailable/invalid provider result
  -> conditional persistence in MySQL
  -> validated frontend response
```

`backend/services/interview_settings.py` reads bounded provider settings. `backend/main.py` creates one reusable OpenAI client at startup when a key exists. The client uses the Responses API, `store=False`, no tools, strict Pydantic output types, bounded output, a total deadline, and at most the configured number of safe transient retries. Missing configuration never prevents API startup.

## Configuration

Local development uses `backend/.env`:

```dotenv
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini
OPENAI_TIMEOUT_SECONDS=20
OPENAI_MAX_OUTPUT_TOKENS=1800
OPENAI_MAX_RETRIES=1
```

Only `OPENAI_API_KEY` is required to enable OpenAI. The other settings have conservative bounded defaults. Never use a `VITE_*` variable for the key.

On Render, open the backend service, choose **Environment**, add `OPENAI_API_KEY`, and optionally override `OPENAI_MODEL`. The database and `CORS_ORIGINS` variables remain required as before.

## Provider operations

- Question generation returns exactly 3, 5, or 8 distinct questions for behavioral, technical, mixed, or role-specific practice.
- Evaluation returns semantic coaching, four bounded score dimensions, exact answer excerpts, and an optional grounded follow-up.
- Debrief returns narrative coaching and patterns across the full interview. Scores, strongest/weakest turns, answer excerpts, and resume-evidence references remain server-controlled.

Job descriptions, resumes, answers, and history are explicitly delimited as untrusted data. Fixed policy forbids obeying embedded instructions, revealing prompts or secrets, using tools, inventing evidence, or making hiring/emotion/body-language claims. The server still validates all model output and applies semantic checks after Structured Outputs parsing.

## Privacy

The provider receives a bounded career-only DTO: job metadata/description/skills plus resume skills, education, experience, projects, and leadership. Name, email, phone, street address, demographic, citizenship, authorization, arbitrary extra fields, and server metadata are excluded. Common sensitive patterns are redacted independently by frontend and backend. Pattern redaction is data minimization, not guaranteed anonymization of arbitrary prose.

OpenAI calls use `store=False`. Logs contain operation, model, duration, outcome, request ID, token usage when available, and exception class. They never intentionally contain API keys, prompts, resumes, raw answers, or raw model responses.

## Sessions, concurrency, and limits

Start, answer, and retrieval require an unexpired bearer login and matching session owner. Interviews expire after 24 hours. Question count means total turns; a useful follow-up replaces the next planned turn and leaves the final planned question intact.

Answer processing uses three phases:

1. A short transaction verifies ownership/current turn and commits a processing claim.
2. Provider evaluation/debrief occurs with no database write transaction held.
3. A new short transaction revalidates the claim and current turn, then conditionally persists the response.

Stale model results are rejected. Identical completed retries replay their cached response. Database uniqueness protects response question and turn identity. Claims older than two minutes can be reclaimed after an interrupted worker.

Each user may start at most 10 interviews per rolling hour. Each session has at most 8 answer turns and 10 attempted provider operations (generation, evaluations, and final debrief). Provider context/output and retries are bounded. The start limit is database-backed; it is intentionally simple and does not replace infrastructure-level abuse protection.

## Failure behavior

Missing key, authentication failure, timeout, connection failure, rate limit, provider 5xx, refusal, incomplete output, malformed/empty/oversized output, or schema/semantic failure falls back for that operation. Raw provider errors are not returned to the browser. The UI labels accepted provider output as **AI coaching active** and fallback output as **Standard coaching mode**.

## Database migration

Run the repository migration runner before deploying this version:

```sh
cd backend
python -m database.migrate
```

Migration `005_harden_interview_sessions.sql` adds processing/cost fields and interview lookup/uniqueness indexes. It is additive and does not delete existing data.

## Developer-only live smoke test

This command makes exactly one structured question-generation request using synthetic data. It is not part of pytest and must not be run without an intentional API key:

```sh
cd backend
python -m scripts.smoke_interview_openai
```

It reports only success/failure and the configured model, never credentials or generated content.

## Validation

Automated tests mock OpenAI; they must never make paid calls. Before review, run:

```sh
cd backend
python -m pytest

cd ../frontend
npm ci
npm test -- --run
npm run build

cd ..
git diff --check
```

A real key is still required to verify account access, live model availability, latency, provider-side rate limits, and output quality in local and Render environments.
