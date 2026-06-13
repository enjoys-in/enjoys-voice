# Enjoys Voice - Roadmap & TODO

## Audit Log Service
- [ ] Create `src/services/audit.service.ts`
- [ ] Log events: register, unregister, call_start, call_answered, call_declined, call_ended, call_failed
- [ ] Each entry: `{ id, timestamp, userId, extension, event, metadata, ip }`
- [ ] In-memory store for dev, persist to SQLite/Postgres for prod (same adapter pattern as registration store)
- [ ] Expose via HTTP API: `GET /api/audit?user=1001&from=&to=&event=`
- [ ] Add to WebSocket admin panel for real-time audit feed

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

## Call Routing: SIP → PSTN Fallback
- [ ] On INVITE: check if callee is registered (SIP-to-SIP)
- [ ] If offline: route via PSTN trunk to their mobile number
- [ ] Trunk config per user: `{ mobile, countryCode, preferSip: true }`
- [ ] Fallback chain: SIP → PSTN → Voicemail
- [ ] Support calling external mobile numbers directly (with country code dial plan)

## Dial Plan
- [ ] Internal: 7-digit extensions (1001-9999)
- [ ] External: `+{countryCode}{number}` → route via trunk
- [ ] IVR: 5000, 1800*, 800* → IVR system
- [ ] Emergency: configurable per-region

## Production Concerns
- [ ] Registration store → Redis/Valkey (done, adapter exists)
- [ ] Audit store → PostgreSQL
- [ ] User store → PostgreSQL with migrations
- [ ] Rate limiting on register/invite
- [ ] TLS for SIP (port 5061)
- [ ] SRTP for media encryption
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

