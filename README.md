run

npm.cmd install
npm.cmd run dev


# WhatsApp history application

The project has a static Vite frontend in `frontend/` and a separate persistent Next.js WhatsApp backend. The frontend signs in with Firebase Authentication and calls the backend using Firebase ID tokens. It reads WhatsApp Web history and stores it in the existing Supabase `wa_conversations` and `wa_messages` tables. It does not provide any send/reply operation and does not use `wa_import_batches`.

## Runtime requirements

Run this on one persistent, unprivileged Node.js instance with Chromium/Puppeteer support and persistent storage. Do not use static Firebase Hosting or a scale-to-zero/serverless runtime for the WhatsApp client. Keep Chromium sandboxing enabled. The OCC PHP proxy remains responsible for checking the PHP session and `role_id = 1`; it must forward requests over HTTPS with `x-occ-backend-secret`. Never expose that secret or the Supabase key to the browser.

## Setup

1. Use Node.js 20 or later and install Chromium dependencies. Puppeteer installs its compatible Chrome during dependency installation. If install scripts are disabled, run `npx puppeteer browsers install chrome`; if using system Chromium, set `PUPPETEER_EXECUTABLE_PATH`.
2. Copy the BE `.env.example` to `.env`, set the server-only Supabase key, Firebase project ID, authorized administrator emails, exact Firebase Hosting origins, and independent OCC/worker secrets. Never expose the BE `.env`.
3. Set `WA_HISTORY_AUTH_PATH` to persistent private storage. Back it up and restrict access; it contains the linked WhatsApp session.
4. Install dependencies with `npm install` (in PowerShell on Windows, use `npm.cmd install` if script execution blocks `npm.ps1`).
5. Run `npm run dev` for local development, or `npm run build` then `npm start` on the persistent production host. The standalone Node process initializes the WhatsApp client automatically. Run exactly one application instance.
6. Set `FIREBASE_PROJECT_ID`, `FIREBASE_AUTHORIZED_EMAILS`, and `WA_HISTORY_ALLOWED_ORIGINS` on the BE, then restart it. The allowlist must contain only approved, verified administrator email addresses.

### Firebase frontend

1. Create a Firebase Web App and enable **Authentication → Email/Password**. Create the permitted users in Firebase Authentication and verify their email addresses.
2. Copy `frontend/.env.example` to `frontend/.env` and fill in the Firebase Web App config, Firebase project ID, and the backend base URL. These Firebase web config values and the backend URL are public; do not put any server keys or shared secrets in this file.
3. Build the static site with `cd frontend` then `npm install` and `npm run build`. Set Firebase Hosting's public directory to `frontend/dist` and deploy with `firebase deploy --only hosting`.
4. On the BE, set `WA_HISTORY_ALLOWED_ORIGINS` to the exact Hosting origins (normally both `https://<project-id>.web.app` and `https://<project-id>.firebaseapp.com`) and `FIREBASE_AUTHORIZED_EMAILS` to the approved email list. Never use `*` for CORS.

The FE supports QR display, connection status, connect/disconnect, sync, conversation/message search, pagination, and Excel export. It does not include send/reply functionality. Firebase Auth protects browser access; the BE independently verifies each ID token and checks the verified email against its server-side allowlist.

### Local full-stack frontend example

The original Next.js local demo remains available at `http://localhost:3000/` while running `npm run dev` in the BE project. Its development-only proxy rejects non-local requests. For the Firebase frontend, use the separate `frontend/` app described above.

The demo proxy uses `WA_BACKEND_INTERNAL_URL` for its server-to-server requests. Set it to the local Next.js URL when using a port other than `3000`.

The WhatsApp Web library is unofficial and may change behavior or be restricted by WhatsApp. Use only accounts you are authorized to link.

## API

All responses use `{ "success": true, "data": ... }`; paginated responses include `pagination`. Errors use an appropriate HTTP status and safe message.

| Method | Route | Authentication |
| --- | --- | --- |
| `GET` | `/api/wa/status` | Firebase ID token or server-only `x-occ-backend-secret` |
| `POST` | `/api/wa/connect` | Firebase ID token or server-only `x-occ-backend-secret` |
| `POST` | `/api/wa/disconnect` | Firebase ID token or server-only `x-occ-backend-secret` |
| `POST` | `/api/wa/sync` | Firebase ID token or server-only `x-occ-backend-secret` |
| `GET` | `/api/wa/conversations?limit=50&offset=0&q=628...` | Firebase ID token or server-only `x-occ-backend-secret` |
| `GET` | `/api/wa/conversations/:id/messages?limit=50&offset=0&q=transaction-id` | Firebase ID token or server-only `x-occ-backend-secret` |
| `GET` | `/api/wa/messages?limit=50&offset=0&q=transaction-id` | Firebase ID token or server-only `x-occ-backend-secret` |
| `GET` | `/api/wa/messages/export?q=transaction-id&conversationId=<uuid>` | Firebase ID token or server-only `x-occ-backend-secret` |
| `POST` | `/api/internal/wa/sync` | `x-wa-worker-secret` |

`limit` is capped at 100. Conversation search matches phone number or display name. Message search matches message body and external message ID. Conversation messages are returned oldest-first; global search results are newest-first. The QR value is returned only from the authenticated status/connect endpoints.

The Excel export downloads all matching messages (up to 10,000 rows) as `.xlsx`. `conversationId` is optional and limits the export to one conversation. The sheet includes date/time, phone, sender, message, direction, message ID, and a WhatsApp-formatted text line. Refine the search if more than 10,000 messages match.

## Postman

Import `postman/WhatsApp-History-Backend.postman_collection.json` and `postman/WhatsApp-History-Backend.postman_environment.json`. Select the local environment, set `occBackendSecret` and `workerSecret` to the matching server secrets, and set `conversationId` from a conversation returned by the API. The internal sync sample requires an existing conversation and a unique `syncExternalId`; it writes a sample message to Supabase.

## Sync behavior and limits

The persistent client reads the latest configured number of messages from each direct (one-to-one) chat on startup and periodically thereafter. WhatsApp LID identifiers are resolved to phone-number JIDs before storage; Excel exports also resolve older LID message IDs against the linked WhatsApp session. Group chats are not stored because the current schema identifies a conversation by phone number. Media and non-text messages are preserved as a body placeholder plus type/media metadata; media files themselves are not downloaded. WhatsApp chat history availability depends on the linked account and library behavior.

Duplicate detection uses `source` and `external_id`, and message sync is serialized within this single worker. The supplied schema has no unique constraint for external IDs, so run exactly one worker instance to avoid cross-process insert races. No schema changes are made by this project.

The worker does not log QR contents, message bodies, cookies, or credentials. Protect server logs and the persistent authentication directory as sensitive data.

The Supabase REST client reads `SUPABASE_URL` and `SUPABASE_KEY` at runtime. It sends the key only in server-to-server `apikey` and `Authorization: Bearer` headers; it is never included in browser responses.
