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
5. Pin HireSense Autofill using Chrome's Extensions menu.

After rebuilding, click **Reload** on the extension card. Refresh the HireSense website and any open application tabs before testing a new content-script build.

## Connect the website

No extension ID environment variable is needed. The manifest injects a small bridge only on `https://hiresense-9yub.onrender.com/*` and `http://localhost:5173/*`. The website pings it, checks protocol version 1, then sends the validated profile. The background worker checks both sender and tab origin. Use **localhost**, not 127.0.0.1, for development handoff. Do not add wildcard origins.

## User flow

1. Upload a resume in HireSense, then open **Application Autofill**.
2. Review/correct the applicant details. Blank details stay blank. Confirm the profile.
3. Choose **Send to extension** and wait for **Profile received**.
4. Open the external application page and click HireSense Autofill.
5. Choose **Preview autofill**. Read the proposed values and manual questions. No second resume upload is required for profile autofill.
7. Choose **Fill supported fields**. Review the grouped results and the actual application.
8. If an application separately requires a resume file, use its own upload button. The optional attachment controls in the popup allow a separate, explicit file selection (PDF/DOCX up to 2 MB) and may immediately upload to the application site. The original bytes are not retained by the HireSense website, so file attachment cannot be silently synced from the earlier upload.
9. Answer the remaining questions yourself and submit manually.
10. Use **Clear profile & resume** when finished.

Changing profile details invalidates website confirmation. Confirm and resend to replace the extension's earlier copy. Closing the popup discards its approval; reopen and preview again. A changed tab, page, profile, field, or expired session requires a fresh preview.

## Privacy and limits

Only the validated, reviewed `ApplicantProfile` is transferred from the website. The same serializer is used on both sides; extra properties, auth tokens, original resume files, and raw resume text are excluded. Country of residence never answers citizenship. After updating from an older extension, confirm and resend the profile.

The confirmed profile is stored in Chrome local extension storage with a 24-hour expiry, surviving service-worker and browser restarts; expired records are removed on the next extension read. Use **Clear synced profile & optional file** to remove it sooner. Profile edits and website logout request a best-effort clear, but if the extension is disabled during that request the prior copy may remain until expiry or explicit clearing. The optional resume file bytes stay in Chrome session storage for 30 minutes and disappear on browser restart or extension reload. Only filename/size metadata is returned to the popup; bytes reach an application tab only for the separate authorized attachment action. Clearing cannot erase answers or recall a file already sent to a site. On a shared browser, clear the profile before switching users.

The 2 MB limit leaves room for base64 encoding within Chrome's session-storage quota. Supported file attachment uses an actual File and DataTransfer FileList, then input/change events. Verification checks retained filename, type, size, and bytes; it does not prove server acceptance. Sites may reject synthetic events or replace/clear the file control after uploading. In those cases check the site's status and use its own Attach button if needed. Existing attachments are never replaced; ambiguous, hidden, or multiple-file controls remain manual.

Preview inspects only the top-level document after the user's action and waits at most 1.5 seconds for a dynamically mounted form. Re-preview after a route or form step change. Standard inputs, single state/country selects, and separately approved conventional resume inputs are supported. Radio buttons and checkboxes stay manual. Cross-origin frames, shadow-DOM controls, custom widgets, other attachments, CAPTCHA, and application-page navigation require manual work. External ATS support is not universal.

The Greenhouse pilot uses custom city and phone-country comboboxes; these remain manual because typing search text does not prove an option was selected. Its ITAR question is classified as sensitive before any state-field alias can match. Citizenship, export controls, work authorization, sponsorship, demographics, legal declarations, references, and arbitrary screening/free-text answers remain manual. No company/job identifiers are hardcoded.

The writer rechecks each approved field, dispatches input/change events, and checks the retained value immediately and after a short framework-settling interval. Phone formatting differences are accepted only when the complete digit sequence is identical; country-code or digit changes fail verification. Later site changes can still occur; manual review remains required.

## Final presenter check

After deploying your reviewed changes, reload extension version 0.4.0 and refresh HireSense and the application tab. Test production profile handoff, browser restart, popup preview, phone formatting, manual ITAR classification, preserved existing answers, optional explicit attachment and the site's upload status, and Clear synced profile & optional file. Automated tests mock Chrome API boundaries; they do not replace this installed-extension check.
