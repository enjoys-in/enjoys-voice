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

## Do Not Disturb (DND) — ✅ DONE
> When a user enables DND, an inbound call must NOT ring their device. Treat it
> as "no answer" (silent) — never a hard decline/unreachable. Route straight to
> voicemail; fall back to a plain SIP 480 only when voicemail is disabled. DND
> also SKIPS the PSTN-mobile leg and the "person is unavailable" announcement
> (those are for genuine unreachability, not an intentional silence).
- [x] Go: `DND bool` (`column:dnd;default:false`) on `UserSettings` +
      `SettingsResponse` + `SettingsInput`; applied in settings update; `dnd`
      added to the Upsert `DoUpdates` column list so it persists on existing rows
- [x] Node: `dnd?: boolean` on `SipUser`; populated via the settings sync that
      already carries pstn (`COALESCE(dnd,false)` in the `user_settings` loaders,
      `applyPstn(...,dnd)`)
- [x] Node: `InternalHandler` routes `reg && user.dnd` → `routeDoNotDisturb`
      (new on `RouteServices`/`SipServer`): voicemail when
      `config.voicemail.enabled && ivr`, else a silent SIP 480 "Do Not Disturb"
- [x] Records the call as `voicemail` (message left) or `missed` (no message)
- [x] Frontend: `dnd` in settings store/type, `go-api` get/updateSettings, DND
      toggle in `SettingsScreen` persisted to the Go settings endpoint
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

## Call Rate & Cost / Billing System (per-minute rating + CDR cost)
> **Goal:** attach a **cost** to every outbound (and optionally inbound) call so
> we can rate calls per-destination, track spend, and (optionally) enforce
> prepaid **balance**. A call is rated on hang-up: `cost = setupFee + ratePerMin ×
> billedMinutes`, where `billedMinutes` is the **billed duration** rounded up to
> the plan's increment (e.g. 60/60 = whole minutes, 1/1 = exact seconds). Two
> rate layers: **buy rate** (what the trunk/provider charges us) and **sell rate**
> (what we charge the user) → the difference is our margin.
>
> **What already exists to build on:**
>   - `call_records` already stores `Duration` (secs), `Direction`, `Status`,
>     `From`/`To`, `StartedAt`/`EndedAt` (`server/internal/models/call.go`) — the
>     raw CDR. We add cost columns to it, no new CDR table needed.
>   - Node already computes duration + writes/upserts the record via
>     `db.logCall` / `db.updateCall` → `CallUpserted` → Postgres write-queue
>     (`src/services/database.service.ts`, `src/index.ts`). Rating hooks in at the
>     same terminal-status update that sets `ended`/`answered`.
>   - Outbound is a single choke point — `ExternalHandler`
>     (`src/sip/routes/external.handler.ts`) + `TrunkService.routeCall`
>     (`src/services/trunk.service.ts`) — ideal for a pre-call balance gate.
>   - Number normalization to E.164 already exists (`formatOutboundUri` /
>     `DialPlanService.normalizeExternal`) → reuse for prefix/rate matching.
>   - The Go `/stats` aggregator (`server/internal/repository/call_repo.go`
>     `Stats`) can be extended to also `SUM(cost)` for the dashboard.

### Data model (Go — system of record)
- [x] New `RatePlan` model (`server/internal/models/rate_plan.go`):
      `{ ID, Name, Currency(size3 'USD'), Default bool, CreatedAt }`. A plan is a
      named collection of destination rates; users are assigned a plan.
- [x] New `Rate` model (`server/internal/models/rate.go`):
      `{ ID, RatePlanID(index), Prefix(size15,index), Description, SellPerMin
      numeric(12,5), BuyPerMin numeric(12,5), SetupFee numeric(12,5) default 0,
      IncrementSecs int default 60, MinSecs int default 0 }`. Match by
      **longest-prefix** on the dialed E.164 (e.g. `91` India, `9180` Bangalore).
- [x] Extend `CallRecord` (`server/internal/models/call.go`): add
      `Cost numeric(12,5) default 0`, `Currency(size3)`, `RatePrefix(size15)`,
      `BilledSecs int`, `RatedAt *time.Time`. Additive — Go AutoMigrate handles it.
      (Node stays the sole WRITER of these too, like the other call columns.)
- [ ] (If prepaid) New `UserBalance` model
      (`server/internal/models/balance.go`): `{ Extension(pk/index), Currency,
      Balance numeric(12,4), UpdatedAt }` + a `BalanceTxn` ledger
      `{ ID, Extension(index), Amount(+credit/−debit), Reason, CallID, CreatedAt }`
      so every deduction/top-up is auditable (never just mutate the balance).

### Rate lookup + cost calculation (decide where it runs)
- [ ] **Pick the rating owner (document it):**
      (a) **Node rates inline** at call-end: load rates into memory (like users via
          LISTEN/NOTIFY), compute cost, stamp it on the `CallLog` before the
          upsert. Pros: one writer, no extra round-trip. ← preferred, matches the
          existing in-memory + write-queue pattern.
      (b) **Go rates async**: Node writes the raw CDR, a Go worker rates it after
          the fact. Pros: keeps money math server-side; Cons: second pass, eventual.
- [x] Longest-prefix matcher: given an E.164, find the `Rate` whose `Prefix` is the
      longest leading match (sort prefixes desc by length; or a trie). Unmatched →
      a configurable **default rate** or block (decide).
      (Done in `RatingService`; unmatched → unrated/cost 0.)
- [x] Billed duration: `billedSecs = max(MinSecs, ceil(duration / IncrementSecs) ×
      IncrementSecs)`; `cost = SetupFee + SellPerMin × billedSecs/60`. Round to the
      currency's minor unit; store `BilledSecs` + `RatePrefix` for transparency.
- [x] Only rate **billable** legs: charge on `answered`/`ended`; **zero cost** for
      `missed`/`failed`/`unreachable`/`ringing` (no media). Inbound is usually free
      — make inbound rating opt-in.
      (Rated at the `ended` choke point; external `to` only — internal/inbound free.)

### Pre-call balance gate (only if prepaid is enabled)
- [ ] In `ExternalHandler` (`src/sip/routes/external.handler.ts`), before
      `routeCall`: look up the caller's balance + the destination sell rate; if
      `balance < estimatedMinCharge` (setup fee + 1 increment) → reject with a
      spoken "insufficient balance" (reuse `IvrSystem.playUnavailable` style) or a
      SIP `402 Payment Required`/`403`. Mirror the existing toll-fraud gate.
- [ ] **Mid-call cutoff (optional, harder):** compute max affordable seconds from
      balance and arm a timer to tear the call down near the limit (FreeSWITCH
      `sched_hangup` / B2BUA timer). Defer if not needed v1.
- [ ] On call-end: debit `UserBalance` by the computed cost inside a txn that also
      writes a `BalanceTxn` row referencing the `CallID` (idempotent on retry —
      guard against double-debit if the upsert runs twice).

### Go API surface (admin rate management + balances)
- [x] CRUD for rate plans + rates (admin-only): `GET/POST /api/g/rate-plans`,
      `GET/PUT/DELETE /api/g/rate-plans/:id`, and nested
      `GET/POST/PUT/DELETE /api/g/rate-plans/:id/rates`. Follow the existing
      handler→service→repository→router layering + `response.OK` envelope.
- [x] Bulk rate import: `POST /api/g/rate-plans/:id/rates/import` (CSV: prefix,
      description, sell, buy, setup, increment) — carrier rate sheets are large.
- [x] Assign a plan to a user: add `RatePlanID` to `UserSettings`
      (`server/internal/models/settings.go`) or a join; default plan when unset.
- [ ] Balances: `GET /api/g/balance/:ext`, `POST /api/g/balance/:ext/topup`
      (admin/credit), `GET /api/g/balance/:ext/txns` (ledger). Derive `ext` from
      JWT for self-reads; restrict top-up/rate CRUD to admins.
- [x] Extend `/api/g/stats` (`call_repo.go` `Stats`) with `SUM(cost)` total +
      per-day cost series + cost-by-direction, so spend shows on the dashboard.
      (Added totalCost + currency + per-day bucket cost.)

### Node wiring (rates in memory + stamp cost)
- [x] Load rate plans/rates + the caller's assigned plan into the in-memory store
      and keep them fresh via the existing Postgres **LISTEN/NOTIFY** sync
      (`UserSyncListener`/`SettingsSyncListener` pattern in `src/index.ts`); add a
      `rates` channel so admin edits in Go reflect without a restart.
      (`RateSyncListener` on `rates_changed`; per-user plan assignment still pending.)
- [x] Add `cost?`, `currency?`, `ratePrefix?`, `billedSecs?` to `CallLog`
      (`src/core/types.ts`); compute + set them in the same place the terminal
      status is written (`updateCall(callId, { status:'ended', endTime, … })` in
      `src/sip/sip.server.ts` / handlers) so the upsert carries the cost.

### Frontend (admin + user)
- [x] Admin **Rates** screen: manage rate plans + rates table (prefix, desc, sell,
      buy, margin, increment). Added methods to `go-api.ts`.
      (CSV import + assign-plans-to-users still pending.)
- [x] Show **cost** per call in the admin Call Logs + user recents (new column),
      and **balance** + recent ledger for the user (if prepaid).
      (Admin Call Logs Cost column done; user recents + balance/ledger pending.)
- [x] Dashboard (`web/app/admin/page.tsx` OverviewTab): add **Total Cost** /
      **Avg Cost per Call** / **Cost over time** cards+chart from the extended
      `/stats` (reuse the recharts setup just added).
      (Total Spend + Avg Cost / Call cards + Spend Over Time area chart done.)

### Guardrails / edge cases
- [ ] **Money math = integers or fixed-precision.** Store as `numeric` in
      Postgres; in JS avoid float drift (use minor units / a decimal lib) — never
      bill on `0.1 + 0.2`.
- [ ] Currency: single currency v1 (config `BILLING_CURRENCY`); multi-currency +
      FX is a later, separate feature.
- [ ] Idempotency: rating must run **once** per call even though `updateCall` can
      fire multiple terminal updates — guard with `RatedAt`/CallID.
- [ ] Missing rate for a destination → **block or default**, never silently
      free-call premium/international (toll-fraud + revenue leak).
- [ ] Rounding/increment policy must match the carrier's so margin isn't negative;
      keep BOTH buy + sell to monitor margin per destination.
- [ ] Inbound/internal (browser↔browser) calls are free by default — only PSTN
      outbound is rated unless explicitly configured.

## Join Microsoft Teams Meeting from Phone/Browser (Audio Conferencing dial-in)
> **Goal:** let our phone/browser user JOIN a Microsoft Teams meeting by having
> our server dial the meeting's **PSTN Audio-Conferencing number** and then
> auto-enter the **Conference ID** via DTMF. The user lands in the Teams meeting
> as a regular phone participant — no Teams/Azure license or SDK on our side.
>
> **Why this is the chosen option (vs. Direct Routing / ACS browser SDK):**
>   - Teams **Direct Routing** is the *opposite* feature (it makes Teams use OUR
>     trunk) and needs a Microsoft-**certified** SBC — drachtio/FreeSWITCH are not
>     certified, so it is out.
>   - **ACS Calling SDK** (native in-browser Teams join) is a separate client +
>     Azure subscription + per-minute billing — a much larger project.
>   - **Audio Conferencing dial-in** works on our EXISTING stack TODAY: outbound
>     PSTN via the trunk + FreeSWITCH MRF for media/DTMF. **Cost is on the meeting
>     ORGANIZER's tenant** (they need the Audio Conferencing license that prints
>     the dial-in number), not on us.
>
> **What already exists to build on:**
>   - Outbound PSTN dial: `TrunkService.routeCall` / `formatOutboundUri`
>     (`src/services/trunk.service.ts`) — `srf.createUAC` B2BUA to the trunk.
>   - FreeSWITCH MRF media engine: `IvrSystem` already does
>     `this.ms.connectCaller(req,res)` → `endpoint.speak/play/record` and
>     `endpoint.execute('set', …)` (`src/sip/ivr.system.ts`). DTMF send is the
>     same surface: `endpoint.execute('send_dtmf', '<digits>')`.
>   - `Endpoint.bridge()` / `MediaServer.createConference()` (`src/drachtio-fsmrf.d.ts`).
>   - Toll-fraud gate (caller must be a registered user) in `ExternalHandler`
>     (`src/sip/routes/external.handler.ts`) — reuse the same guard here.

### Trigger / entry point (how a user starts a join)
- [ ] **Decide the trigger** (pick one, document it):
      (a) **WS action** (preferred for the browser UI): add a `join_meeting`
          message to `src/websocket/signaling.server.ts` with
          `{ pstnNumber, conferenceId }`; the server originates the call.
      (b) Special dialed string the dial plan recognizes (e.g.
          `**teams*<number>*<confId>#`) parsed in
          `src/services/dialplan.service.ts` → new `RouteType.TeamsMeeting`.
- [ ] Frontend: a "Join Teams meeting" panel — fields for **dial-in number** +
      **Conference ID**, OR a single textarea to **paste the meeting invite** and
      auto-extract both (regex e.g. `Phone Conference ID:\s*([\d\s]+)#?` and the
      toll/toll-free number). A "Join" button fires the trigger.

### Server media flow (answer → dial Teams → DTMF the ID → bridge)
- [ ] New handler (e.g. `src/sip/routes/teams-meeting.handler.ts`) or an
      `IvrSystem` method modeled on `recordVoicemail`/`playUnavailable`:
  - [ ] `connectCaller(req,res)` to answer the user's A-leg onto a FreeSWITCH
        endpoint (optionally `speak` a "connecting you to the meeting" prompt).
  - [ ] Originate the **B-leg** to the Teams dial-in number via the trunk
        (reuse `formatOutboundUri` for E.164 normalization + trunk auth/From).
  - [ ] After the B-leg ANSWERS and Teams' IVR prompts, send the Conference ID:
        `endpoint.execute('send_dtmf', '<conferenceId>#')` on the **B-leg toward
        Teams** (append `#`; some flows also need a trailing confirmation key).
  - [ ] **Bridge** A-leg ↔ B-leg (`endpoint.bridge(...)`) so the user is in the
        meeting; tear down both legs on either hangup (mirror the
        `uac/uas .on('destroy')` cleanup in `TrunkService.routeCall`).
- [ ] **DTMF timing:** Teams won't accept digits until its greeting starts. Either
      wait a fixed delay, or (better) gate on B-leg answer + a short pause before
      `send_dtmf`. Make the pause/`#` behavior configurable.
- [ ] **DTMF transport:** ensure RFC 2833 / telephone-event is negotiated on the
      trunk leg (Teams dial-in expects out-of-band DTMF). Verify the trunk’s
      codec/2833 settings; fall back to inband only if required.

### Config / metadata
- [ ] Optional convenience config: a default/known Teams dial-in number per
      region so users only paste the **Conference ID** (the number rarely changes
      per tenant). Keep per-call override.
- [ ] Outbound CLI on the Teams leg is irrelevant to dial-in (Teams identifies the
      participant by Conference ID, not CLI) — use the shared
      `TRUNK_CALLER_NUMBER`; this is independent of the BYON caller-ID feature.

### Guardrails / edge cases
- [ ] **Reuse the toll-fraud gate:** only a **registered** user may trigger a join
      (same check as `ExternalHandler`) so this path can't be abused to dial
      arbitrary/premium numbers. Rate-limit join attempts.
- [ ] Wrong/expired Conference ID → Teams re-prompts or rejects; add a timeout +
      spoken "couldn't join the meeting" fallback, then hang up cleanly.
- [ ] International dial-in numbers → normalize via `formatOutboundUri`; allow the
      user to pick the toll vs toll-free number from the invite.
- [ ] Record the attempt in call history (`db.logCall`) with a recognizable
      target (e.g. `teams:<confId>`) so it shows in recents/stats.
- [ ] **Licensing note (document in UI):** joining works only if the meeting
      ORGANIZER's tenant has **Audio Conferencing** enabled (that's what generates
      the dial-in number + Conference ID). Nothing to license on our side.
- [ ] (Optional, later) Outbound name/announcement: have FreeSWITCH speak the
      caller's name on entry, or DTMF-send a PIN if the meeting requires one.

