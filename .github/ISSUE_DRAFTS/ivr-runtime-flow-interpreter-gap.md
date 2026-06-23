# IVR: saved builder flows are not executed at call time (runtime ignores `ivr_flows`)

## Summary
The visual IVR Builder lets users design and save custom flows (menus, TTS/audio
prompts, "press N → branch", transfer/voicemail/hangup), but the live SIP runtime
**never loads or executes them**. Incoming IVR calls always play a hardcoded
menu instead of the caller's saved flow.

## Current Behavior
- Users build flows in the web admin (`web/app/admin/ivr/`) and save them.
- Flows persist per extension in Postgres `ivr_flows(extension, enabled, graph JSONB)`
  via the Go API (`/ivr/flows`).
- At call time, `IVRSystem.handleIncomingCall()` (`src/sip/ivr.system.ts`) plays a
  **hardcoded** language + department menu ("Press 1 for English… Press 1 for Sales…")
  and a fixed `deptMap`.
- The entire Node `src/` tree never reads `ivr_flows` — the saved graph is unused
  on calls.

## Expected Behavior
An incoming IVR call to a DID/extension that has a saved, enabled flow should
**execute that flow**: play each node's prompt (TTS or uploaded audio), collect
DTMF, follow the matching branch, and run terminal actions (transfer / voicemail /
hangup). If no flow exists, fall back to the current built-in menu (no regression).

## How the pieces connect today
- **Storage:** Go writes `ivr_flows(id, name, extension, enabled, graph JSONB)` —
  unique per `extension` (`server/migrations/001_initial.sql`). `graph` = `{ nodes, edges }`.
- **Node DB access:** the Bun/Node SIP app already talks to the **same Postgres**
  via `getPool()` + repos in `src/services/postgres/`, with live cache invalidation
  through `pg-listener.ts` + `*-notify.ts`.
- **Entry point:** `src/sip/routes/ivr.handler.ts` → `services.ivr.handleIncomingCall(req, res, callId)`.
  The dialed number is `route.target`.
- **Node kinds** (`web/app/admin/ivr/ivr.types.ts`): `start, menu, play, condition,
  transfer, voicemail, hangup`. Prompts are `{ mode: 'tts'|'audio', text?, audioFile? }`.

## Proposed Solution (phased)

### Phase 1 — Load flows in the Node runtime
- New repo `src/services/postgres/ivr.repo.ts`: `getFlowByExtension(ext)` →
  `SELECT ... FROM ivr_flows WHERE extension=$1 AND enabled=true`, parse `graph`
  JSONB into `{ nodes, edges }`.
- Expose `DatabaseService.getIvrFlow(ext)` with an in-memory cache.

### Phase 2 — Runtime types
- `src/sip/ivr/flow.types.ts`: minimal runtime mirror of the node-data shapes +
  `IvrEdge` (`source`, `sourceHandle`, `target`). Single source of truth on the
  Node side.

### Phase 3 — The interpreter
- `src/sip/ivr/flow-runner.ts` → `runFlow(endpoint, flow, ctx, services)`:
  1. Find the `start` node → play `greeting` → follow its single out-edge.
  2. Loop: dispatch on `node.kind`, get the next node id, repeat until a terminal
     node or hangup.
  3. **Edge resolution for menus:** pressed digit → matching `option.id` → edge
     where `sourceHandle === option.id` → `target`.
  4. Guards: max-steps loop protection, overall timeout, caller-hangup detection.

### Phase 4 — Per-node handlers
- `start` → play greeting, go to next.
- `play` → render prompt (barge-in optional), go to next.
- `menu` → render prompt + `promptAndCollect()` (reuse `src/sip/ivr.system.ts`)
  with `validDigits/tries/timeoutMs`; on invalid/timeout play `invalidPrompt` and
  retry, then fall through.
- `condition` → evaluate `variable`/`operator`/`value` against the channel
  (caller_id, dialed_number, last digits, time/day) → follow `true`/`false` branch.
- `transfer` → reuse existing routing (department/extension) from `src/sip/sip.server.ts`
  (trunk / `forwardCall`).
- `voicemail` → reuse `recordVoicemail()` with the node's mailbox/greeting/maxSeconds.
- `hangup` → end + destroy.

### Phase 5 — Prompt rendering helper
- TTS: `endpoint.speak({ ttsEngine:'flite', voice:'slt', text })`.
- Audio: `endpoint.play(`${IVR_DIR}/<audioFile>`)` (the FS-shared mount).
- **Security:** validate `audioFile` is a bare filename (reject `/` and `..`) since
  it is user-uploaded — prevents path traversal.

### Phase 6 — Wire into `handleIncomingCall`
- After `connectCaller` + answer: `const flow = db.getIvrFlow(dialedNumber)`.
  - If found & enabled → `runFlow(...)`.
  - Else → keep the current hardcoded language/department menu as **fallback**
    (no regression).
- Pass the dialed DID from `route.target` through `IvrHandler`.

### Phase 7 — Safety & edge cases
- Missing/empty flow, no `start` node, dangling edge, DB down → graceful fallback
  or spoken "sorry" + hangup.
- Loop guard (e.g. max 50 node hops).
- Audit each node transition for debugging.

### Phase 8 — Live updates & tests
- Add an `ivr_flows` NOTIFY listener (mirror the existing `*-notify.ts` pattern) so
  builder edits invalidate the flow cache and apply **without a restart**.
- Pure unit tests for edge-resolution + condition evaluation.
- Manual call matrix: menu branch, nested menu, transfer, voicemail, hangup,
  invalid-digit retry.

## Affected Files
- `src/sip/ivr.system.ts` (wire-in + reuse helpers)
- `src/services/database.service.ts` (new `getIvrFlow`)
- `src/services/postgres/ivr.repo.ts` (new)
- `src/sip/ivr/flow.types.ts`, `src/sip/ivr/flow-runner.ts` (new)
- `src/sip/routes/ivr.handler.ts` (pass dialed DID)

## Acceptance Criteria
- [ ] A saved, enabled flow runs on an incoming call to its extension/DID.
- [ ] `menu` branches by DTMF; invalid/timeout retries then falls through.
- [ ] `play`, `transfer`, `voicemail`, `hangup`, `condition` nodes work end-to-end.
- [ ] TTS and uploaded-audio prompts both play; `audioFile` is path-traversal safe.
- [ ] No flow → existing hardcoded menu still works (no regression).
- [ ] Builder edits take effect without restarting the SIP service.

## Notes / Dependencies
- To confirm during implementation: how the `condition` node encodes its two
  branches (likely `sourceHandle` = `true`/`false`).
- Blocked for end-to-end verification by the separate media bug
  (`Crypto not negotiated but required`) — IVR audio won't be reachable on the VPS
  until WebRTC media completes (currently `CALLS-IN` ~4020 / `FAILED` ~4018).
