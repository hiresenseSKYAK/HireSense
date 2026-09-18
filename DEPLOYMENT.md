# HireSense deployment readiness

HireSense can be deployed as a static Vite frontend plus a FastAPI service backed by MySQL. No provider-specific rewrite is required.

## Frontend

- Build command from the repository root: `cd frontend && npm ci && npm run build`
- Publish directory: `frontend/dist`
- Required environment variable: `VITE_API_BASE_URL=https://<your-api-origin>`
- Optional browser-bridge variable: `VITE_AUTOFILL_EXTENSION_ID=<unpacked-or-published-extension-id>`

The `VITE_` values are public build-time configuration. Do not place database passwords, API secrets, or auth tokens in them.

The frontend uses `BrowserRouter`. Configure the static host to **rewrite** every path that is not a real asset to `/index.html` with HTTP 200. Without this rule, refreshing routes such as `/resume` or `/application/prepare` returns a host-level 404. This must be a rewrite rather than a redirect.

## Backend

- Install the normal web service from the repository root: `cd backend && python -m pip install -r requirements-web.txt`
- Start from the repository root: `cd backend && python -m uvicorn main:app --host 0.0.0.0 --port $PORT`
- Health check: `GET /health`
- Required database variables: `DB_HOST`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD`
- Optional database variable: `DB_PORT` (defaults to `3306`)
- Required deployment variable: `CORS_ORIGINS=https://<your-frontend-origin>`

`CORS_ORIGINS` accepts a comma-separated list, so local development can keep `http://localhost:5173` alongside the deployed frontend URL when needed.

The backend must run with `backend` as its working directory because its imports are rooted there. If the host has a separate working-directory setting, set it to `backend` and use `python -m uvicorn main:app --host 0.0.0.0 --port $PORT`.

## MySQL and runtime considerations

Use any student-budget managed MySQL-compatible database reachable from the backend host. The application runs `Base.metadata.create_all()` and its existing summary-column compatibility check at API startup. The database must already exist, and the configured user needs `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `CREATE`, and `ALTER` permissions. Startup fails if MySQL is unavailable or the required variables are missing. Passwords containing URL-special characters are supported.

The normal API startup does not import the crawler AI modules or download Transformer models. `requirements-web.txt` also avoids installing Torch, Transformers, BeautifulSoup, Requests, and scheduler packages into the web service.

Run the crawler separately from Uvicorn. For scheduled low-memory ingestion,
install `requirements-crawler.txt` and set `SUMMARIZE_JOB_DESCRIPTIONS=false`
and `EXTRACT_JOB_SKILLS=false`. This avoids Torch/Transformers while retaining
extractive summaries and deterministic skill matching.

## Production job pipeline

The live path is: scheduled GitHub Action → LinkedIn/Handshake public pages →
validation and normalization → identity upsert → Aiven MySQL → FastAPI → Vite
frontend → the real application page → HireSense Autofill. The API never seeds
or substitutes mock listings. An empty database returns an empty list; a database
failure returns HTTP 503.

From `backend`, install the lightweight crawler with
`python -m pip install -r requirements-crawler.txt`. Apply tracked additive
migrations with `python -m database.migrate`. A safe manual validation is:

```text
set SUMMARIZE_JOB_DESCRIPTIONS=false
set EXTRACT_JOB_SKILLS=false
python -m crawler.crawl --dry-run --source linkedin --limit 10 --skip-cleanup
```

Replace `linkedin` with `handshake` to isolate that source. Remove `--dry-run`
only after reviewing real titles, companies, and application URLs in the output.
The `--limit` value caps accepted jobs across the selected source. `--skip-cleanup`
prevents link-status checks.

For a live source check that cannot touch MySQL, run
`python -m scripts.validate_job_sources --source handshake --limit 100` (or
`--source linkedin --limit 150`). The validator does not import database
connection code. A full manual crawl can omit `--limit`; bounded defaults are
150 LinkedIn, 100 Handshake, and 250 combined. A value such as 10 is only a
development sample.

For the first production rollout, run
`python -m scripts.production_job_rollout` from `backend` in a terminal that
already has the production `DB_*` variables. It refuses any database target
other than the canonical production host, port, and database; prompts before
migration and before writes; runs full bounded dry-runs for both sources; and
reports before/after totals, source counts, and duplicate checks.

The workflow `.github/workflows/crawl-jobs.yml` runs every six hours and can be
started manually. Add repository secrets named `DB_HOST`, `DB_PORT`, `DB_NAME`,
`DB_USER`, and `DB_PASSWORD`. It installs `requirements-crawler.txt`, applies
migrations, disables heavyweight enrichment, prevents overlapping runs, and
uses production ceilings of 150 LinkedIn and 100 Handshake candidates.

Jobs refresh in place using source IDs first and normalized application URLs
second, with a conservative metadata fallback only if both are unavailable.
Tracking query parameters are removed while functional query parameters remain.
A confirmed 404, 410, or explicit closed-page message deactivates a job. Listings
older than 30 days (or without a posted date) are checked at most weekly.
Authentication failures, rate limits, timeouts, server errors, and network errors
are inconclusive and never deactivate a job. Source failures are isolated and
reported in the crawl summary.

Greenhouse and Lever expose maintainable public board APIs only for configured
employer board identifiers; they do not provide general employer discovery.
Future adapters should live beside the existing parsers, emit the same normalized
job dictionary with `source_job_id`, and enter through `upsert_job`.

To verify data is real, check crawler sample logs, query `job_data`, then compare
`GET /jobs/` and `GET /jobs/market-insights`. Real API rows include working
application links and the market total equals eligible active database rows.
When troubleshooting, run one source with `--dry-run --limit 10`; no result from
one source does not prevent the other source from running.

An empty successful `GET /jobs/` response means no active eligible rows exist.
HTTP 503 means the database query failed. Every crawl summary reports discovered,
accepted, rejected, inserted, updated, idempotent, invalid, duplicate,
deactivated, source-error, and duration counts; parser logs include rejection
reasons without credentials.

## Browser bridge production setup

The extension is intentionally local/unpacked for the capstone demonstration. Before a deployed HireSense origin can send a confirmed profile, add that exact HTTPS origin to `frontend/extension/static/manifest.json` under `externally_connectable.matches`, build the extension, load or publish it, and set its resulting ID as `VITE_AUTOFILL_EXTENSION_ID` for the frontend build. The extension uses session-only storage and never receives auth tokens or resume text.

## Remaining external actions

You must choose and create the frontend host, backend host, and MySQL instance; set their environment variables; and supply the final frontend origin for CORS and the extension manifest. Those actions require accounts and provider credentials, so they are intentionally not performed from this repository.
