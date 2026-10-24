run

npm.cmd install
npm.cmd run dev


# WhatsApp history backend

Next.js backend for the existing OCC frontend, including a **local-only demo page** at `/`. It reads WhatsApp Web history and stores it in the existing Supabase `wa_conversations` and `wa_messages` tables. It does not provide any send/reply operation and does not use `wa_import_batches`.

## Runtime requirements

Run this on one persistent, unprivileged Node.js instance with Chromium/Puppeteer support and persistent storage. Do not use static Firebase Hosting or a scale-to-zero/serverless runtime for the WhatsApp client. Keep Chromium sandboxing enabled. The OCC PHP proxy remains responsible for checking the PHP session and `role_id = 1`; it must forward requests over HTTPS with `x-occ-backend-secret`. Never expose that secret or the Supabase key to the browser.

## Setup

1. Use Node.js 20 or later and install Chromium dependencies. Puppeteer installs its compatible Chrome during dependency installation. If install scripts are disabled, run `npx puppeteer browsers install chrome`; if using system Chromium, set `PUPPETEER_EXECUTABLE_PATH`.
2. Copy `.env.example` to `.env.local`, set `SUPABASE_URL` and server-only `SUPABASE_KEY` from the OCC server configuration, and generate two independent high-entropy secrets for the OCC proxy and WhatsApp worker. `SUPABASE_SERVICE_ROLE_KEY` is also accepted as a backwards-compatible alternative.
3. Set `WA_HISTORY_AUTH_PATH` to persistent private storage. Back it up and restrict access; it contains the linked WhatsApp session.
4. Install dependencies with `npm install` (in PowerShell on Windows, use `npm.cmd install` if script execution blocks `npm.ps1`).
5. Run `npm run dev` for local development, or `npm run build` then `npm start` on the persistent production host. The standalone Node process initializes the WhatsApp client automatically. Run exactly one application instance.
6. Forward only the protected API routes through the OCC PHP proxy. The proxy must authorize the OCC session and superadmin role before forwarding.

### Frontend demo on Firebase Hosting

The `frontend/` directory contains a standalone static demo suitable for Firebase Hosting. In the Firebase CLI setup, set the public directory to `frontend`, answer `No` to the single-page-app rewrite (the demo is a single `index.html`), and answer `No` to automatic GitHub deployment if you deploy manually. Then deploy with `firebase deploy --only hosting`. It shows illustrative UI only and does not access WhatsApp or Supabase data.

Do not add backend secrets to this static frontend. To display real OCC WhatsApp history, connect it through an authenticated OCC/PHP proxy that validates the session and role before forwarding requests to the backend. Never put the backend shared secret or Supabase key in browser code.

### Local full-stack frontend example

Open `http://localhost:3000/` while running `npm run dev`. The local Next.js demo displays the connection/QR status, conversations, message history, and search. Search results can be downloaded as an Excel workbook. It calls a development-only server proxy; the OCC secret is never sent to browser JavaScript. That proxy is disabled in production and rejects requests whose host is not localhost/loopback. Do not deploy this demo as an authenticated OCC UI; replace it with the authenticated OCC/PHP proxy integration.

The demo proxy uses `WA_BACKEND_INTERNAL_URL` for its server-to-server requests. Set it to the local Next.js URL when using a port other than `3000`.

The WhatsApp Web library is unofficial and may change behavior or be restricted by WhatsApp. Use only accounts you are authorized to link.

## API

All responses use `{ "success": true, "data": ... }`; paginated responses include `pagination`. Errors use an appropriate HTTP status and safe message.

| Method | Route | Authentication |
| --- | --- | --- |
| `GET` | `/api/wa/status` | `x-occ-backend-secret` |
| `POST` | `/api/wa/connect` | `x-occ-backend-secret` |
| `POST` | `/api/wa/disconnect` | `x-occ-backend-secret` |
| `POST` | `/api/wa/sync` | `x-occ-backend-secret` |
| `GET` | `/api/wa/conversations?limit=50&offset=0&q=628...` | `x-occ-backend-secret` |
| `GET` | `/api/wa/conversations/:id/messages?limit=50&offset=0&q=transaction-id` | `x-occ-backend-secret` |
| `GET` | `/api/wa/messages?limit=50&offset=0&q=transaction-id` | `x-occ-backend-secret` |
| `GET` | `/api/wa/messages/export?q=transaction-id&conversationId=<uuid>` | `x-occ-backend-secret` |
| `POST` | `/api/internal/wa/sync` | `x-wa-worker-secret` |

`limit` is capped at 100. Conversation search matches phone number or display name. Message search matches message body and external message ID. Conversation messages are returned oldest-first; global search results are newest-first. The QR value is returned only from the authenticated status/connect endpoints.

The Excel export downloads all matching messages (up to 10,000 rows) as `.xlsx`. `conversationId` is optional and limits the export to one conversation. The sheet includes date/time, phone, sender, message, direction, message ID, and a WhatsApp-formatted text line. Refine the search if more than 10,000 messages match.

## Postman

Import `postman/WhatsApp-History-Backend.postman_collection.json` and `postman/WhatsApp-History-Backend.postman_environment.json`. Select the local environment, set `occBackendSecret` and `workerSecret` to the matching server secrets, and set `conversationId` from a conversation returned by the API. The internal sync sample requires an existing conversation and a unique `syncExternalId`; it writes a sample message to Supabase.

## Sync behavior and limits

The persistent client reads the latest configured number of messages from each direct (one-to-one) chat on startup and periodically thereafter. WhatsApp LID identifiers are resolved to phone-number JIDs before storage; Excel exports also resolve older LID message IDs against the linked WhatsApp session. Group chats are not stored because the current schema identifies a conversation by phone number. Media and non-text messages are preserved as a body placeholder plus type/media metadata; media files themselves are not downloaded. WhatsApp chat history availability depends on the linked account and library behavior.

Duplicate detection uses `source` and `external_id`, and message sync is serialized within this single worker. The supplied schema has no unique constraint for external IDs, so run exactly one worker instance to avoid cross-process insert races. No schema changes are made by this project.

The worker does not log QR contents, message bodies, cookies, or credentials. Protect server logs and the persistent authentication directory as sensitive data.

## PHP proxy contract

The OCC server must authenticate the current PHP session and verify `role_id = 1` before proxying. It then sets `x-occ-backend-secret` from server-side configuration and forwards the request to this backend. Do not trust a role, cookie, or secret supplied by browser JavaScript. The PHP proxy itself is not included in this workspace.

The Supabase REST client reads `SUPABASE_URL` and `SUPABASE_KEY` at runtime. It sends the key only in server-to-server `apikey` and `Authorization: Bearer` headers; it is never included in browser responses.
