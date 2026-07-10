# SMS / Text Messaging

> **Goal:** send and receive SMS from the browser (and later the mobile app) using
> the existing Twilio trunk. Messages are stored in Postgres, threaded by
> conversation (contact number), and pushed to the browser in real time via the
> existing WebSocket signalling layer.
>
> **What already exists to build on:**
>   - Twilio SIP trunk (`TrunkService`, `TRUNK_*` env) — the Twilio account can
>     send/receive SMS via the REST API + webhooks; no new provider needed.
>   - `nodemailer` (IVR email connector) — similar outbound pattern, just a
>     different transport.
>   - WebSocket signalling (`src/websocket/signaling.server.ts`) — already
>     broadcasts call events and presence; SMS events are the same shape.
>   - `DatabaseService` in-memory caching + Postgres write-queue pattern (`DbEvent`
>     emit → listener → SQL upsert) — reuse for message persistence.
>   - Go API layered architecture (model → repo → service → handler → router) —
>     add `sms_messages` alongside `call_records`.
>   - Push service (`src/services/push.service.ts`) — can add an `incoming_sms`
>     push type for the mobile app.
>   - Contact store (`web/app/stores/contact.store.ts`) — resolves names for
>     display; SMS threads can reuse this.

## Data Model (Go — system of record)

- [ ] New `SmsMessage` model (`server/internal/models/sms.go`):
      `{ ID uuid pk, OwnerExtension string(index), Direction enum('inbound','outbound'),
      From string, To string, Body text, Status enum('queued','sent','delivered',
      'failed','received'), ProviderSid string(index, nullable),
      ErrorCode string(nullable), ErrorMessage string(nullable),
      CreatedAt, UpdatedAt }`. AutoMigrate.
- [ ] No in-memory mirror needed — SMS is not on the call path; direct Postgres
      reads/writes are fine (low volume, no latency requirement).

## Inbound SMS (Twilio → Node → Postgres → browser)

- [ ] **Twilio webhook endpoint** — `POST /api/n/sms/incoming`
      (`src/http/routes/sms.routes.ts`). Twilio sends `From`, `To`, `Body`,
      `MessageSid`, `AccountSid`, `NumMedia` etc. as form-encoded. Verify the
      request signature (`X-Twilio-Signature`) against `TWILIO_AUTH_TOKEN` to
      prevent spoofed webhooks.
- [ ] Resolve `To` → owner extension (reuse `db.findPstnForwardTarget` or
      `db.getUserByPhone` on the DID's owning user). If unresolvable, log and
      respond `200` (Twilio retries on non-200).
- [ ] Insert into `sms_messages` (direction=`received`, status=`received`).
- [ ] **Broadcast to the owner's browser** via WebSocket signalling — new event
      type `sms_incoming`:
      `{ type: 'sms_incoming', from, body, messageId, timestamp }`.
      The web client updates the thread in real time (no polling).
- [ ] **Push notification** — extend `PushService` with an `incoming_sms` data
      message so the mobile app shows a notification (same FCM path as
      `incoming_call`, lower priority).
- [ ] Respond to Twilio with an empty TwiML `<Response/>` (no auto-reply).

## Outbound SMS (browser → Node → Twilio)

- [ ] **REST endpoint** — `POST /api/n/sms/send`
      (`src/http/routes/sms.routes.ts`), body `{ to, body }`. Requires JWT auth
      (same middleware as the existing Node HTTP routes).
- [ ] Normalize `to` to E.164 (reuse `DialPlanService.normalizeExternal`).
- [ ] Use Twilio REST API (`POST https://api.twilio.com/2010-04-01/Accounts/{Sid}/Messages.json`)
      with `From` = `TRUNK_CALLER_NUMBER` (or the user's verified outbound
      caller ID if set), `To`, `Body`. Credentials from `TWILIO_ACCOUNT_SID` +
      `TWILIO_AUTH_TOKEN` env.
- [ ] Insert into `sms_messages` (direction=`outbound`, status=`queued`), update
      to `sent`/`delivered`/`failed` on Twilio status callback.
- [ ] **Twilio status callback** — `POST /api/n/sms/status`
      (`src/http/routes/sms.routes.ts`). Twilio POSTs delivery receipts
      (`MessageSid`, `MessageStatus`). Signature-verified. Update the row's
      `status`. Optionally push the status change to the browser via WS.

## Go API Surface (conversation reads + history)

- [ ] `GET /api/g/sms` — list all conversations (grouped by the remote number,
      latest message + unread count per thread). Paginated.
      Owner = JWT extension.
- [ ] `GET /api/g/sms/:number` — thread detail (all messages with a specific
      number, newest first). Paginated.
- [ ] `DELETE /api/g/sms/:id` — delete a single message (owner guard).
- [ ] `POST /api/g/sms/mark-read` — mark a thread as read (set an `unread`
      flag or use a separate `sms_read_cursors` approach).
- [ ] Add SMS stats to `/api/g/stats`: `totalSms`, `smsSent`, `smsReceived`.

## Frontend (web — conversation-threaded UI)

- [ ] New `MessagesScreen.tsx` (`web/app/components/screens/MessagesScreen.tsx`):
      - Thread list view (like iMessage / WhatsApp): avatar + name/number, last
        message preview, timestamp, unread dot.
      - Thread detail view: bubble layout (sent = right/blue, received =
        left/gray), timestamps, delivery status indicator.
      - Compose bar at the bottom with text input + send button.
      - New-message button → number input or contact picker.
- [ ] New `sms.store.ts` (`web/app/stores/sms.store.ts`): Zustand store for
      threads + messages, with `fetchThreads`, `fetchThread`, `sendMessage`,
      `markRead`. Cache with TTL like the voicemail store.
- [ ] Add `sms` namespace to `api.ts` (Node endpoints) and `go-api.ts` (Go
      endpoints).
- [ ] Add a **Messages** tab/icon to the bottom nav (alongside Keypad, Recents,
      Contacts, Voicemail, Settings).
- [ ] WebSocket listener: on `sms_incoming` → update the thread in real time,
      show a toast notification, increment unread badge.
- [ ] Contact name resolution: use the contact store to display names instead of
      raw numbers.

## Config

- [ ] New env vars:
      `TWILIO_ACCOUNT_SID` — already exists in `.env.example` for caller-ID
      verification; reuse.
      `TWILIO_AUTH_TOKEN` — for REST API calls + webhook signature verification.
      `SMS_ENABLED` (default `false`) — master switch; endpoints return 404 when
      off, nav tab is hidden.
      `SMS_FROM_NUMBER` — the number Twilio sends from; defaults to
      `TRUNK_CALLER_NUMBER`.
- [ ] Twilio console: point the DID's **Messaging webhook** at
      `https://<domain>/api/n/sms/incoming` (POST) and the **Status callback**
      at `https://<domain>/api/n/sms/status` (POST).

## Guardrails / Edge Cases

- [ ] **Webhook signature verification**: every inbound webhook (`/sms/incoming`,
      `/sms/status`) must verify `X-Twilio-Signature` against the auth token +
      request URL + params. Reject unverified requests with 403.
- [ ] **Rate limiting**: throttle outbound sends per extension (e.g. 1 msg/sec,
      100 msgs/day) to prevent abuse and runaway Twilio bills.
- [ ] **MMS / media**: Twilio delivers `NumMedia` + `MediaUrl0..N` for picture
      messages. v1: store the media URLs as metadata on the message row; display
      as clickable links. v2: download + proxy through our server so the Twilio
      URLs don't expire.
- [ ] **Multi-line / multi-DID**: v1 assumes one DID (the trunk number). If
      multiple DIDs are added later, route by `To` in the inbound webhook.
- [ ] **Cost**: SMS is billed per-segment by Twilio. Optionally extend the
      `RatingService` to rate SMS (a `sms` rate type with per-message pricing)
      and debit the prepaid balance, but defer to v2.
- [ ] **Character encoding**: Twilio handles GSM-7 / UCS-2 segmentation. Just
      pass the raw body; show a character counter in the compose bar (160 / 70
      char segments).
- [ ] **Opt-out / STOP**: Twilio's Advanced Opt-Out handles `STOP`/`UNSTOP`
      automatically at the account level. No app-side handling needed v1.
