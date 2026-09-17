# HireSense Autofill Bridge

This small Manifest V3 extension keeps the website as the product and supplies an explicit browser bridge for an external application tab.

## Local demonstration

1. Run `npm run build:extension` from `frontend`.
2. In Chrome, open `chrome://extensions`, enable Developer mode, and load `extension/dist` unpacked.
4. Copy the extension ID into `frontend/.env.local` as `VITE_AUTOFILL_EXTENSION_ID=<extension-id>`, then restart Vite.
5. Confirm a profile in HireSense and choose **Send confirmed profile to browser bridge**.
6. Open an application page, click the extension, and choose **Fill supported fields**.

The bridge uses `activeTab`, session-only extension storage, and the shared deterministic matcher. It never stores auth tokens, sends resume text, or submits an application. Production requires adding the deployed HireSense origin to `externally_connectable.matches` before building the extension.
