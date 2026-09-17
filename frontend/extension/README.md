# HireSense Autofill

A user-controlled Chrome bridge for conventional application forms. The website and extension share one deterministic matcher. Neither clicks Submit, Next, nor advances application pages.

## Build and load

From `frontend`:

```sh
npm ci
npm test
npm exec tsc -- --noEmit
npm run build
npm run build:extension
```

The extension build also type-checks its background, content, and popup scripts.

1. Open **chrome://extensions** in Chrome.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select **HireSense/frontend/extension/dist** (the folder containing manifest.json).
5. Copy the 32-letter **ID** shown on the HireSense Autofill card. Keep loading the same directory so that Chrome keeps the same ID.
6. Pin HireSense Autofill using Chrome's Extensions menu.

After rebuilding, click **Reload** on the extension card. Refresh any open application tabs before testing a new content-script build.

## Connect the deployed website

On the Render **frontend static site**, set:

```text
VITE_AUTOFILL_EXTENSION_ID=your_actual_32_letter_extension_id
VITE_API_BASE_URL=https://hiresense-api-qg6u.onrender.com
```

Paste only the extension ID as the value: no quotes, URL, or angle brackets. Vite reads these variables at build time, so rebuild/redeploy the frontend after setting them. Each person loading an unpacked extension may have a different ID; the website must target the presenter's ID. A published extension with a stable ID is outside this pass.

The exact production origin `https://hiresense-9yub.onrender.com/*` and intentional development origin `http://localhost:5173/*` are already allowed in the manifest and checked again by the background script. For local development set the same ID in `frontend/.env.local` and restart Vite. Use **localhost**, not 127.0.0.1, for extension handoff.

## User flow

1. Upload a resume in HireSense, then open **Application Autofill**.
2. Review/correct the applicant details. Blank details stay blank. Confirm the profile.
3. Choose **Send to extension** and wait for **Profile received**.
4. Open the external application page and click HireSense Autofill.
5. Choose **Preview autofill**. Read the proposed values and manual questions.
6. Choose **Fill supported fields**. Review the per-field results and the actual application.
7. Answer the remaining questions yourself and submit manually.
8. Use **Clear profile** when finished.

Changing profile details invalidates website confirmation. Confirm and resend to replace the extension's earlier copy. Closing the popup discards its approval; reopen and preview again. A changed tab, page, profile, field, or expired session requires a fresh preview.

## Privacy and limits

Only ten explicitly allowed applicant fields are transferred. Extra properties, auth tokens, resume files, and raw resume text are excluded. Profiles use Chrome session storage and expire after 30 minutes (checked before each action); they also disappear when the browser session ends or the extension is reloaded/disabled. Clear profile removes the stored profile, but does not erase answers already written to an application.

Preview inspects only the top-level document after the user's action. Standard inputs and single state selects are supported. Cross-origin frames, shadow-DOM controls, custom widgets, file uploads, CAPTCHA, and application-page navigation require manual work. External ATS support is not universal.

The writer rechecks each approved field, dispatches input/change events, and checks the retained value immediately and after a short framework-settling interval. Later site changes can still occur; manual review remains required.

## Final presenter check

After deploying your reviewed changes and configuring the ID, test on your Chrome installation: production profile handoff, popup preview, one supported external application, preserved existing answers, one manual question, result verification, and Clear profile. Automated tests mock Chrome API boundaries; they do not replace this installed-extension check.
