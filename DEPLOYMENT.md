# HireSense deployment readiness

HireSense can be deployed as a static Vite frontend plus a FastAPI service backed by MySQL. No provider-specific rewrite is required.

## Frontend

- Build command: `cd frontend && npm ci && npm run build`
- Publish directory: `frontend/dist`
- Required environment variable: `VITE_API_BASE_URL=https://<your-api-origin>`
- Optional browser-bridge variable: `VITE_AUTOFILL_EXTENSION_ID=<unpacked-or-published-extension-id>`

The `VITE_` values are public build-time configuration. Do not place database passwords, API secrets, or auth tokens in them.

## Backend

- Install: `cd backend && python -m pip install -r requirements.txt`
- Start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
- Health check: `GET /health`
- Required database variables: `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD`
- Required deployment variable: `CORS_ORIGINS=https://<your-frontend-origin>`

`CORS_ORIGINS` accepts a comma-separated list, so local development can keep `http://localhost:5173` alongside the deployed frontend URL when needed.

## MySQL and runtime considerations

Use any student-budget managed MySQL-compatible database with public network access restricted to the backend host. The application creates its tables at backend startup, so the selected database user needs normal schema access.

The crawler can download large Transformer models on its first run (roughly 700 MB based on the documented defaults) and can consume more memory than a small web service. Keep crawler execution separate from the request-serving process, use the configured schedule, and disable optional summarization/skill extraction in constrained environments with `SUMMARIZE_JOB_DESCRIPTIONS=false` and `EXTRACT_JOB_SKILLS=false`.

## Browser bridge production setup

The extension is intentionally local/unpacked for the capstone demonstration. Before a deployed HireSense origin can send a confirmed profile, add that exact HTTPS origin to `frontend/extension/static/manifest.json` under `externally_connectable.matches`, build the extension, load or publish it, and set its resulting ID as `VITE_AUTOFILL_EXTENSION_ID` for the frontend build. The extension uses session-only storage and never receives auth tokens or resume text.

## Remaining external actions

You must choose and create the frontend host, backend host, and MySQL instance; set their environment variables; and supply the final frontend origin for CORS and the extension manifest. Those actions require accounts and provider credentials, so they are intentionally not performed from this repository.
