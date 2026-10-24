run

npm.cmd install
npm.cmd run dev


# WhatsApp history application

The project has a static Vite frontend in `frontend/` and a separate persistent Next.js WhatsApp backend. The frontend login is verified by the backend against the existing Supabase `tb_user` table; the FE never talks to Supabase directly. The worker reads WhatsApp Web history and stores it in `wa_conversations` and `wa_messages`. The app has no send/reply operation and does not use `wa_import_batches`.

## Runtime requirements

Run this on one persistent, unprivileged Node.js instance with Chromium/Puppeteer support and persistent storage. Do not use static Firebase Hosting or a scale-to-zero/serverless runtime for the WhatsApp client. Keep Chromium sandboxing enabled. The FE login is checked by the BE against Supabase `tb_user`; only `role_id = 1` accounts with valid bcrypt passwords are accepted. Never expose the OCC shared secret or Supabase key to the browser.

## Setup

1. Use Node.js 20 or later and install Chromium dependencies. Puppeteer installs its compatible Chrome during dependency installation. If install scripts are disabled, run `npx puppeteer browsers install chrome`; if using system Chromium, set `PUPPETEER_EXECUTABLE_PATH`.
2. Copy the BE `.env.example` to `.env`, set the server-only Supabase key, an independent `WA_AUTH_TOKEN_SECRET`, exact Firebase Hosting origins, and independent OCC/worker secrets. Never expose the BE `.env`.
3. Set `WA_HISTORY_AUTH_PATH` to persistent private storage. Back it up and restrict access; it contains the linked WhatsApp session.
4. Install dependencies with `npm install` (in PowerShell on Windows, use `npm.cmd install` if script execution blocks `npm.ps1`).
5. Run `npm run dev` for local development, or `npm run build` then `npm start` on the persistent production host. The standalone Node process initializes the WhatsApp client automatically. Run exactly one application instance.
6. Ensure `tb_user` is available through the server-only Supabase key and has bcrypt password hashes. Login permits only `role_id = 1`. Set `WA_HISTORY_ALLOWED_ORIGINS` on the BE and restart it.

### Firebase frontend

1. Copy `frontend/.env.example` to `frontend/.env` and set only the backend base URL. Do not put user passwords or backend secrets in this file.
2. Build the static site with `cd frontend` then `npm install` and `npm run build`. Set Firebase Hosting's public directory to `frontend/dist` and deploy with `firebase deploy --only hosting`.
3. On the BE, set `WA_HISTORY_ALLOWED_ORIGINS` to the exact Hosting origins (normally both `https://<project-id>.web.app` and `https://<project-id>.firebaseapp.com`). Never use `*` for CORS.

The FE supports login against Supabase `tb_user`, QR display, connection status, connect/disconnect, sync, conversation/message search, pagination, and Excel export. The BE checks Laravel-compatible bcrypt hashes and only allows `role_id = 1`; it issues short-lived signed sessions. Passwords and Supabase keys never go to browser code. The UI does not include send/reply functionality.

### Local full-stack frontend example

The original Next.js local demo remains available at `http://localhost:3000/` while running `npm run dev` in the BE project. Its development-only proxy rejects non-local requests. For the Firebase frontend, use the separate `frontend/` app described above.

The demo proxy uses `WA_BACKEND_INTERNAL_URL` for its server-to-server requests. Set it to the local Next.js URL when using a port other than `3000`.

The WhatsApp Web library is unofficial and may change behavior or be restricted by WhatsApp. Use only accounts you are authorized to link.

## API

All responses use `{ "success": true, "data": ... }`; paginated responses include `pagination`. Errors use an appropriate HTTP status and safe message.

| Method | Route | Authentication |
| --- | --- | --- |
| `POST` | `/api/auth/login` | Supabase `tb_user` email/password; bcrypt and `role_id = 1` checked on BE |
| `GET` | `/api/wa/status` | Signed session token or server-only `x-occ-backend-secret` |
| `POST` | `/api/wa/connect` | Signed session token or server-only `x-occ-backend-secret` |
| `POST` | `/api/wa/disconnect` | Signed session token or server-only `x-occ-backend-secret` |
| `POST` | `/api/wa/sync` | Signed session token or server-only `x-occ-backend-secret` |
| `GET` | `/api/wa/conversations?limit=50&offset=0&q=628...` | Signed session token or server-only `x-occ-backend-secret` |
| `GET` | `/api/wa/conversations/:id/messages?limit=50&offset=0&q=transaction-id` | Signed session token or server-only `x-occ-backend-secret` |
| `GET` | `/api/wa/messages?limit=50&offset=0&q=transaction-id` | Signed session token or server-only `x-occ-backend-secret` |
| `GET` | `/api/wa/messages/export?q=transaction-id&conversationId=<uuid>` | Signed session token or server-only `x-occ-backend-secret` |
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
