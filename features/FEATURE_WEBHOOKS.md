# Webhook on Call Events (Personal Automation)

> **Goal:** fire HTTP webhooks on call lifecycle events so you can integrate with
> personal automation tools (Zapier, n8n, Make, Home Assistant, IFTTT, custom
> scripts). E.g., "When I miss a call, create a task in Todoist" or "When a
> voicemail arrives, send it to Slack."
>
> **What already exists to build on:**
>   - **Webhook service**: `src/services/webhook/` directory exists. Go model
>     `webhook.go` + `WebhooksTab.tsx` admin UI — webhooks CRUD (create, list,
>     enable/disable, delete) is **already fully implemented**.
>   - **Webhook dispatcher**: the webhook system already fires on call events.
>     This feature spec is about **documenting what exists** and **extending**
>     the event types to cover more use cases.
>   - **Audit events**: `audit.service.ts` logs lifecycle events that the webhook
>     dispatcher can hook into.
>   - **WS call events**: `signaling.server.ts` broadcasts `call_event` messages
>     (ringing, answered, ended, missed, etc.).

## Current State (verify and document)

- [ ] Verify which events the webhook dispatcher already fires on:
      - `call.started` — a new call is initiated
      - `call.answered` — a call is answered
      - `call.ended` — a call ends normally
      - `call.missed` — a call was not answered
      - Others?
- [ ] Verify the webhook payload shape: likely
      `{ event, callId, from, fromName, to, toName, direction, status, duration,
      timestamp }`.
- [ ] Verify retry behavior: does it retry on failure? How many times?

## New Event Types to Add

- [ ] `voicemail.new` — fired when a voicemail is saved. Payload:
      `{ event: 'voicemail.new', voicemailId, mailbox, from, fromName, duration,
      transcript?, timestamp }`.
      Hook point: after `db.addVoicemail()` in `IvrSystem.recordVoicemail()`.
- [ ] `voicemail.transcribed` — fired when a voicemail transcript is ready.
      Payload: `{ event: 'voicemail.transcribed', voicemailId, mailbox, transcript }`.
- [ ] `sms.received` — fired when an inbound SMS arrives (if SMS feature is
      built). Payload: `{ event: 'sms.received', from, to, body, messageId }`.
- [ ] `registration.online` — fired when a user registers (comes online).
      Payload: `{ event: 'registration.online', extension, userAgent, timestamp }`.
- [ ] `registration.offline` — fired when a user unregisters or times out.

## Webhook Configuration (already exists in WebhooksTab)

The admin UI already supports:

- [ ] **URL**: the endpoint to POST to.
- [ ] **Events**: which event types to fire on (checkboxes or multi-select).
- [ ] **Enabled**: on/off toggle.
- [ ] **Secret**: an HMAC signing secret for verifying webhook authenticity. The
      dispatcher should sign the payload with `HMAC-SHA256(secret, body)` and
      include it in a `X-Signature-256` header.

## Delivery

- [ ] **HTTP POST** with `Content-Type: application/json`.
- [ ] **Timeout**: 10 seconds per delivery. If the endpoint doesn't respond in
      time, mark as failed.
- [ ] **Retry**: on failure (non-2xx or timeout), retry up to 3 times with
      exponential backoff (5s, 30s, 2min).
- [ ] **Logging**: log each delivery attempt (success/fail, status code, latency)
      in the `webhook_deliveries` table for debugging.
- [ ] **Circuit breaker**: if a webhook fails 10 times consecutively, auto-disable
      it and notify the user.

## Integration Examples (document in README or UI)

- [ ] **n8n / Zapier**: point the webhook URL at an n8n webhook trigger or a
      Zapier catch hook. No auth needed (or use the HMAC secret).
- [ ] **Home Assistant**: POST to
      `http://homeassistant.local:8123/api/webhook/<id>`. Example: turn on a
      light when a call comes in, flash red on missed call.
- [ ] **Slack**: POST to a Slack incoming webhook URL. Format the payload as a
      Slack block kit message in a middleware (or use n8n/Zapier as the adapter).
- [ ] **Todoist / task manager**: create a task on missed call ("Call back +1-555-1234").

## Guardrails / Edge Cases

- [ ] **Never blocking**: webhook delivery is async / fire-and-forget. A slow or
      failed webhook must never delay call teardown or voicemail save.
- [ ] **Payload size**: keep payloads small (< 4KB). Don't include full
      transcripts in webhook payloads by default — include a `transcriptUrl` that
      the consumer can fetch if needed.
- [ ] **Rate limiting**: throttle webhook deliveries (max 10/sec per URL) to
      avoid overwhelming consumer endpoints.
- [ ] **Security**: the HMAC signature lets the consumer verify that the webhook
      came from our server, not a spoofed request.
- [ ] **SSRF protection**: validate the webhook URL on creation — block
      `localhost`, `127.0.0.1`, `10.*`, `192.168.*`, etc. to prevent server-side
      request forgery.
