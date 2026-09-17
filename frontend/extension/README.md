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

The extension build also type-checks its background, content, popup, and resume-chooser scripts.

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
5. Optionally choose **Choose active resume**. In the extension's separate page, select a PDF or DOCX up to 2 MB and choose **Use this resume for this session**. Return to the application and reopen the popup.
6. Choose **Preview autofill**. Read the proposed values and manual questions.
7. Choose **Fill supported fields**. Review the grouped results and the actual application.
8. For a recognized resume input, separately choose **Attach resume to [site]**. This may immediately upload the file to that site. Check its filename and upload status before proceeding.
9. Answer the remaining questions yourself and submit manually.
10. Use **Clear profile & resume** when finished.

Changing profile details invalidates website confirmation. Confirm and resend to replace the extension's earlier copy. Closing the popup discards its approval; reopen and preview again. A changed tab, page, profile, field, or expired session requires a fresh preview.

## Privacy and limits

Only fourteen explicitly allowed applicant fields are transferred from the website: name fields, email, phone, city, state, country of residence, two address lines, postal code, LinkedIn, GitHub, and portfolio. New address/country fields start blank and must be entered and confirmed; country never answers citizenship. Extra properties, auth tokens, original resume files, and raw resume text are excluded from the website handoff. After updating from an older extension, confirm and resend the expanded profile.

The optional active resume is selected separately in the extension. Its real file bytes stay in Chrome session memory, never local/sync storage or URLs. Profiles and resumes are usable for 30 minutes; expired data is cleared on the next extension action. Chrome clears session storage on browser restart or extension reload/disable. Only filename/size metadata is returned to the popup; bytes reach an application tab only for the separate authorized attachment action. Clear profile & resume removes both stored items, but cannot erase answers or recall a file already sent to a site.

The 2 MB limit leaves room for base64 encoding within Chrome's session-storage quota. Supported file attachment uses an actual File and DataTransfer FileList, then input/change events. Verification checks retained filename, type, size, and bytes; it does not prove server acceptance. Sites may reject synthetic events or replace/clear the file control after uploading. In those cases check the site's status and use its own Attach button if needed. Existing attachments are never replaced; ambiguous, hidden, or multiple-file controls remain manual.

Preview inspects only the top-level document after the user's action. Standard inputs, single state/country selects, and separately approved conventional resume inputs are supported. Cross-origin frames, shadow-DOM controls, custom widgets, other attachments, CAPTCHA, and application-page navigation require manual work. External ATS support is not universal.

The Greenhouse pilot uses custom city and phone-country comboboxes; these remain manual because typing search text does not prove an option was selected. Its ITAR question is classified as sensitive before any state-field alias can match. Citizenship, export controls, work authorization, sponsorship, demographics, legal declarations, references, and arbitrary screening/free-text answers remain manual. No company/job identifiers are hardcoded.

The writer rechecks each approved field, dispatches input/change events, and checks the retained value immediately and after a short framework-settling interval. Phone formatting differences are accepted only when the complete digit sequence is identical; country-code or digit changes fail verification. Later site changes can still occur; manual review remains required.

## Final presenter check

After deploying your reviewed changes and configuring the ID, reload extension version 0.3.0 and refresh the application tab. Test production profile handoff, active-resume selection, popup preview, phone formatting, manual ITAR classification, preserved existing answers, explicit attachment and the site's upload status, and Clear profile & resume. Automated tests mock Chrome API boundaries; they do not replace this installed-extension check.
