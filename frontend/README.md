# HireSense frontend

HireSense is a React, TypeScript, and Vite application for discovering DFW and explicit U.S.-remote technology roles, understanding resume-to-job overlap, preparing applicant details, and practicing job-specific interview answers.

## Local development

Requirements: Node.js 18 or newer and the HireSense FastAPI service.

```sh
npm ci
npm run dev
```

The frontend defaults to `http://127.0.0.1:8000` for API requests. Set `VITE_API_BASE_URL` to use another backend. Set `VITE_AUTOFILL_EXTENSION_ID` when testing the Chrome extension bridge.

## Routes

| Route | Purpose |
|---|---|
| `/login` | Account sign-in and registration |
| `/` | Server-paginated job discovery, filters, sorting, matching, and market context |
| `/jobs/:id` | Job details, resume overlap, application preparation, and interview practice |
| `/resume` | PDF/DOCX upload, parsed resume evidence, and improvement guidance |
| `/profile` | Account, current resume, match summary, and Autofill readiness |
| `/application/prepare` | Review and confirm the applicant profile sent to Autofill |
| `/application/preview` | Controlled local demonstration of preview-first filling |
| `/privacy` | Autofill privacy policy |

Protected routes require a current HireSense account session.

## Validation

```sh
npm test -- --run
npm run build
npm run build:extension
```

The main build includes TypeScript checking. The extension build separately type-checks and bundles the Manifest V3 background, content, popup, and resume-selection scripts.

## Architecture notes

- Job search, filters, sorting, matching, and pagination are handled by the live backend; the browser renders one page of results at a time.
- Resume analysis is saved in browser local storage for the current browser profile. A failed replacement upload preserves the last successful analysis.
- Autofill requires explicit profile review and confirmation. The extension stores confirmed profile and optional resume data in Chrome session storage for up to 30 minutes.
- Autofill previews before writing, preserves existing answers, rejects ambiguous or sensitive fields, verifies writes, and never submits or advances an application.

See [`extension/README.md`](extension/README.md) for the installed-extension workflow and the repository-level `DEPLOYMENT.md` for production configuration.
