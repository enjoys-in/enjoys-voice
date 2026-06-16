# Enjoys Voice - Roadmap & TODO

> **Status legend:** ✅ done · 🟡 partial · (unmarked) = not started.
> See [LEARNING.md](LEARNING.md) for a concept-to-code guide of what already exists.

## Audit Log Service — ✅ DONE
- [x] `src/services/audit.service.ts` (env-gated `AUDIT_LOG`, 30s batch flush)
- [x] Logs register/call lifecycle + `call_blocked` events
- [x] Each entry: `{ id, timestamp, extension, event, detail }`
- [x] Persists to Postgres (`audit_logs`, additive to Go's GORM model); Go owns reads (`/api/g/audit`)
- [ ] Real-time audit feed in the WebSocket admin panel

## SIP URI Domain
- [ ] Replace `.invalid` contact domain with `config.server.domain` (e.g., `enjoys.in`)
- [ ] Client SIP.js URI: `sip:{extension}@{DOMAIN}` read from env `SIP_DOMAIN`
- [ ] Server side: accept registrations for `@enjoys.in` domain
- [ ] From/To headers use `sip:1001@enjoys.in` format

## Caller Name Display (show name, not number)
> We ALREADY save `name` at signup: `{ extension, username(=phone), password, name, mobile, registered }`.
> Inbound already shows names (`fromName` via WS, `remoteIdentity.displayName` via SIP).
> Gap is outbound + SIP-level display name. Tasks:
- [ ] Outbound: resolve callee name before dialing via **WebSocket** (add a `lookup`/`get_user` WS message → server replies with `{ extension, name, mobile }`; do NOT use REST `/api/lookup`) and pass it as `makeCall(target, targetName)` so `peerName` shows the name
- [ ] Set SIP `From` display name on outbound INVITE (UserAgent `displayName` / Inviter `fromDisplayName`) so the callee sees OUR name, not extension
- [ ] Set `displayName` to the user's saved `name` (currently set to `extension` in `useSipPhone.register`)
- [ ] Server: stamp `fromName` from `db.getUser(ext)?.name` on all call signaling events (partially done for `incoming_call`)
- [ ] Fallback chain for display: saved contact name → user `name` → mobile/extension number
- [ ] (Optional) Local contacts/address book so users can name unknown numbers

## User Signup via Mobile
- [ ] Add `POST /api/signup` — accepts `{ countryCode, mobile, name }`
- [ ] Generate extension automatically (e.g., mobile number or sequential)
- [ ] OTP verification via SMS gateway (Twilio/MSG91/custom)
- [ ] On signup: create SIP user, assign extension, store in DB
- [ ] Login via mobile + OTP (no password needed for end users)

## Call Routing: SIP → PSTN Fallback — ✅ DONE
- [x] On INVITE: check if callee is registered (SIP-to-SIP)
- [x] If offline/unreachable: `SipServer.routeUnreachable()` chain — PSTN-forward to mobile → forwarding rules → voicemail → spoken "unavailable" → 480
- [x] Per-user PSTN forward (`pstnForwardToBrowser` / `mobile` / `pstnForwardTarget`)
- [x] Stale registration returns `410 Gone`; busy `486`, no-answer `408`/timeout mapped to forwarding branches

## Dial Plan
- [ ] Internal: 7-digit extensions (1001-9999)
- [ ] External: `+{countryCode}{number}` → route via trunk
- [ ] IVR: 5000, 1800*, 800* → IVR system
- [ ] Emergency: configurable per-region

## Production Concerns
- [x] Registration store → Redis/Valkey (adapter exists; falls back to in-memory when `REDIS_URL` unset)
- [x] Audit store → PostgreSQL (`audit_logs`, batch-flushed)
- [x] Live data sync → Postgres LISTEN/NOTIFY (Node mirrors Go-owned tables, no polling)
- [x] WSS for SIP + drachtio `<tls>` on :5066 + `<spammers>` scanner drop + internal-only control socket
- [ ] User store migrations hardening (seed + idempotent; Go AutoMigrate in place)
- [🟡] Rate limiting on register/invite (HTTP `rate-limit` middleware exists; SIP-level pending)
- [ ] SRTP for media encryption end-to-end (browser already DTLS-SRTP; trunk leg pending)
- [ ] Horizontal scaling: multiple drachtio instances behind load balancer

## Go Voice Core (sipgo)

 
- [ ] Trunk model: `{ id, name, host, port, transport, username, password, callerNumber, prefix, codecs, enabled }`
- [ ] REST API endpoints:
  - `GET /api/trunks` — list all trunks
  - `POST /api/trunks` — create trunk
  - `GET /api/trunks/:id` — get trunk details
  - `PUT /api/trunks/:id` — update trunk
  - `DELETE /api/trunks/:id` — delete trunk
  - `POST /api/trunks/:id/test` — test trunk connectivity (OPTIONS ping)
- [ ] Trunk registration: periodic REGISTER to upstream providers
- [ ] Outbound routing: Go handles PSTN/external calls via configured trunks
- [ ] Inbound routing: receive calls from trunks, forward to Node SIP server
- [ ] Health checks: monitor trunk status (registered/failed/retrying)
- [ ] Database: PostgreSQL for trunk persistence
- [ ] Config hot-reload: update trunk config without restart
- [ ] Integrate with Node server: Go handles trunks, Node handles WebRTC/WS clients

## Sound Upload: IVR Normalization (ffmpeg)
> Go API already has `POST /api/g/sounds/upload` + `GET /api/g/sounds/:ext` for
> `caller_tune` / `ringtone`. Extend to `ivr` and normalize audio for FreeSWITCH.
> Use a dedicated **ffmpeg Docker** (separate container/sidecar) rather than
> baking ffmpeg into the Go API image — Go calls it to transcode uploads.
- [ ] Add `ivr` to the accepted `type` whitelist in `sound_handler.go`
- [ ] Stand up an ffmpeg container (or sidecar service) the Go API can invoke
- [ ] On `ivr` upload: transcode to FreeSWITCH-canonical format
      `ffmpeg -i <in> -ar 16000 -ac 1 -c:a pcm_s16le <ext>_ivr_<ts>.wav`
      (8k narrowband vs 16k wideband — pick the FS target; store only the .wav)
- [ ] Validate real format by magic bytes (`RIFF`/`WAVE`, `OggS`), not the
      spoofable client `Content-Type`; whitelist output extension to `.wav`
- [ ] Handle transcode subprocess: timeout, non-zero exit, sanitize paths
- [ ] Store IVR sounds on a path the **FreeSWITCH** container can read
      (bind mount), since IVR prompts are played server-side by FS — unlike
      caller_tune/ringtone which the browser fetches and resamples itself
- [ ] Fix IDOR: derive `extension` from the JWT (`c.GetString("extension")`),
      not from `PostForm("extension")` — same ownership fix as voicemail
- [ ] Wire the frontend `SettingsScreen` upload to actually POST to the Go
      endpoint (currently local-only `URL.createObjectURL`); add `uploadSound`
      to `go-api.ts` and settle the `type` key contract (snake_case on the wire)
- [ ] (Optional) Expose a delete route — `sound_service.Delete` exists but is
      not routed

## Do Not Disturb (DND)
> When a user enables DND, an inbound call must NOT ring their device. Treat it
> as "no answer" (silent) — never a hard decline/unreachable. Route straight to
> voicemail; fall back to a plain SIP 480 only when voicemail is disabled. DND
> also SKIPS the PSTN-mobile leg and the "person is unavailable" announcement
> (those are for genuine unreachability, not an intentional silence).
- [ ] Go: add `DND bool` (default false) to `UserSettings` + `SettingsResponse`
      (`api/internal/models/settings.go`), a migration column, and accept it in
      the settings update handler/service
- [ ] Node: add `dnd?: boolean` to `SipUser` (`src/core/types.ts`) and populate
      it on the in-memory user via the same settings LISTEN/NOTIFY sync that
      already carries mobile/forwarding (`database.service.ts`)
- [ ] Node: in `InternalHandler.handle` (`src/sip/routes/internal.handler.ts`),
      when `reg && targetUser.dnd` → go STRAIGHT to voicemail (skip ringing /
      B2BUA). Do NOT reuse `routeUnreachable` as-is (it does PSTN-first +
      announcement). Add a small DND branch: voicemail if
      `config.voicemail.enabled && ivr`, else send SIP 480.
- [ ] Record the call as `voicemail` (message left) or `missed`/`unreachable`
      (no message) so it still shows in the callee's recents
- [ ] Frontend: add `dnd` to the settings store + a toggle in `SettingsScreen`
      and persist via the Go settings update (`go-api.ts`)

## Outbound Caller ID — Verified BYON (per-user real number)
> **Goal:** a browser→PSTN call presents the *caller's own* real mobile as the
> Caller ID (CLI), not one shared company number. Browser↔browser keeps using the
> **extension** (it never touches the trunk, so no CLI rules apply). The IVR /
> inbound hotline keeps its own **shared** number (toll-free) — intentionally
> separate, no change needed: the dial plan already routes `5000` / `1800*` /
> `800*…` to IVR (`src/services/dialplan.service.ts`), distinct from user calls.
>
> **Why this isn't just "set the From header" — two independent trust layers:**
>   1. *App trust* — the user controls that SIM (who they are to us).
>   2. *Carrier authorization* — the trunk is **allowed** to present that number
>      as `From`. Enforced by the provider + STIR/SHAKEN. **This is the layer that
>      actually decides whether the call goes through.**
> Proving layer 1 alone is not enough: if the number isn't registered as a
> **Verified Caller ID on the trunk account**, the provider rejects it, overrides
> the `From`, or STIR/SHAKEN flags it as spoofed.
>
> **Decision (this iteration): use PROVIDER-NATIVE verification. Do NOT build our
> own SMS OTP sender.** The provider (Twilio *Outgoing Caller IDs* API) places the
> verification call/SMS to the user's number and reads them a code; we just
> confirm it. The number then becomes verified *on our account* → only then may we
> present it. `trunk.sendSms` stays **unused** for this feature. Only **Twilio** is
> wired into the live app today (`src/index.ts`); Telnyx/Plivo/Vonage providers are
> dormant, so BYON starts Twilio-only.

### Data model (Go) — store the verified number + status
- [ ] Extend `UserSettings` (`server/internal/models/settings.go`, already holds
      `PstnMobile` + `PstnCountryCode`): add `OutboundCallerId string` (E.164),
      `CallerIdVerified bool` (default false), `CallerIdVerifiedAt *time.Time`, and
      `CallerIdValidationSid string` (the Twilio validation-request id). Mirror the
      first three into `SettingsResponse`.
- [ ] Additive migration columns (Go AutoMigrate handles it). Do **not** treat
      `User.Mobile` as "verified for outbound" — it's only the signup number.
- [ ] Accept the fields in the settings update handler/service, but keep
      `CallerIdVerified` / `...At` **read-only to the client** — only the verify
      flow may flip them.

### Verification flow (provider-native, NO self-sent SMS)
- [ ] Go: `POST /api/g/caller-id/verify/start` — body `{ number, countryCode }`.
      Normalize to E.164, then create a Twilio **Validation Request**
      (`/2010-04-01/Accounts/{Sid}/OutgoingCallerIds`). Twilio calls/texts the
      number with a 6-digit code. Persist the returned `ValidationRequestSid`;
      respond `{ status: "pending" }`. (Twilio speaks/sends the code — we send nothing.)
- [ ] Go: `POST /api/g/caller-id/verify/confirm` — Twilio finalizes once the user
      enters the code on the call, so "confirm" really means *re-check status*:
      look up the `OutgoingCallerId` by number; when present → set
      `CallerIdVerified=true`, `CallerIdVerifiedAt=now`, `OutboundCallerId=<number>`.
- [ ] Go: `GET /api/g/caller-id` — return `{ number, verified, verifiedAt }`.
- [ ] Go: `DELETE /api/g/caller-id` — clear the verified CLI **and** delete the
      Twilio `OutgoingCallerId`, so the user can re-verify a different number.
- [ ] Ownership: derive `extension` / `user_id` from the JWT
      (`c.GetString("extension")`), never from the request body (same IDOR fix as
      voicemail/sounds).
- [ ] **Out of scope (explicit):** our own SMS OTP sender (`trunk.sendSms`) — the
      provider performs the verification.

### Outbound `From` override (Node SIP path)
- [ ] Node: add `outboundCallerId?: string` to `SipUser` (`src/core/types.ts`),
      populated by the existing settings LISTEN/NOTIFY sync that already carries
      mobile/forwarding (`src/services/database.service.ts` → `hydrateUserDetail`).
- [ ] `ExternalHandler` (`src/sip/routes/external.handler.ts`) already resolves the
      registered caller — look up that user's `outboundCallerId` and pass it into
      `routeCall(...)` as a new `callerId` argument.
- [ ] `TrunkService.routeCall` (`src/services/trunk.service.ts`) currently hardcodes
      `From: <sip:{config.trunk.callerNumber}@host>` — use the passed `callerId`
      when present, else fall back to `config.trunk.callerNumber`.
- [ ] **Fallback policy (decide + document):** when a user has **no** verified
      caller ID → either (a) block outbound PSTN with a clear "verify your number"
      error, or (b) fall back to the shared `TRUNK_CALLER_NUMBER`.

### Frontend
- [ ] `SettingsScreen`: a "Caller ID" panel — show the current verified number and
      a "Verify my number" button → calls `/caller-id/verify/start`, then shows
      "Twilio is calling you, enter the code", then a "Done / refresh" that calls
      confirm. Surface the verified / pending / none states.
- [ ] Add the endpoints to `go-api.ts`; add the fields to the settings store.
- [ ] If outbound is blocked while unverified, the dialer should explain why and
      deep-link to the verify panel.

### IVR / inbound — unchanged (shared toll-free), note only
- [ ] No change required: IVR keeps its own **shared** business number; the dial
      plan already classifies `5000` / `18\d{8}` / `1800*` / `800*…` as
      `RouteType.IVR` (`src/services/dialplan.service.ts`), separate from per-user
      outbound CLI.

### Guardrails / edge cases
- [ ] STIR/SHAKEN: a verified-but-not-owned number gets ~B-level attestation (fine
      for most; a few carriers may still label the call). Full A-level needs an
      **owned** DID (a larger, separate feature).
- [ ] Re-verify on number change; expire/invalidate stale verifications; one
      verified CLI per user for now.
- [ ] Provider lock-in: verified caller ID is per-provider (Twilio-only until the
      other providers are wired into the live app).
- [ ] Rate-limit `verify/start` (anti-abuse — each call triggers a real, billable
      Twilio call/SMS).

