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

Run the crawler as a separate scheduled worker only when needed. Install its full environment with `python -m pip install -r requirements.txt`. A low-memory crawler deployment should set `SUMMARIZE_JOB_DESCRIPTIONS=false` and `EXTRACT_JOB_SKILLS=false`; this keeps the deterministic catalog fallback and avoids downloading roughly 700 MB of models. Do not run the crawler inside the Uvicorn web process.

## Browser bridge production setup

The extension is intentionally local/unpacked for the capstone demonstration. Before a deployed HireSense origin can send a confirmed profile, add that exact HTTPS origin to `frontend/extension/static/manifest.json` under `externally_connectable.matches`, build the extension, load or publish it, and set its resulting ID as `VITE_AUTOFILL_EXTENSION_ID` for the frontend build. The extension uses session-only storage and never receives auth tokens or resume text.

## Remaining external actions

You must choose and create the frontend host, backend host, and MySQL instance; set their environment variables; and supply the final frontend origin for CORS and the extension manifest. Those actions require accounts and provider credentials, so they are intentionally not performed from this repository.
