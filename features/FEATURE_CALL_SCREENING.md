# Call Whisper / Screening

> **Goal:** before you answer an incoming call from an unknown or external number,
> hear a short **whisper announcement** telling you who's calling — without the
> caller hearing anything. If you don't like what you hear, send it to voicemail
> with one tap. For personal use this eliminates spam/robocall pickups and lets
> you be informed before connecting.
>
> **How it works (from the user's perspective):**
>   1. An inbound call arrives (PSTN or internal).
>   2. Instead of immediately ringing, the system briefly connects YOU (the callee)
>      to a FreeSWITCH endpoint that **speaks** the caller's identity:
>      *"Call from Bob Smith, mobile"* or *"Call from plus one five five five,
>      one two three four"*.
>   3. During the whisper, the caller hears normal ringing (ring-back tone).
>   4. After the whisper (2–3 seconds), the call rings your phone/browser normally.
>   5. Optionally: the whisper is played into your **earpiece only** as the call
>      rings, so you hear it overlaid on the ringtone.
>
> **What already exists to build on:**
>   - FreeSWITCH MRF integration: `IvrSystem` already does
>     `ms.connectCaller(req,res)` → `endpoint.speak('...')`. The same TTS engine
>     can speak the whisper.
>   - Caller name resolution: `db.getUser(ext)?.name`, `db.lookupContactName()`,
>     `fromName` from the SIP `From` display name — a chain already exists.
>   - Contact store enrichment (from FEATURE_CONTACTS.md): if the caller is a
>     saved contact, use their name.
>   - B2BUA call flow: `srf.createB2BUA()` bridges A-leg (caller) to B-leg
>     (callee). The whisper must happen BEFORE the bridge.
>   - `routeToExtension()` in `sip.server.ts` — the central place where an
>     internal call is rung. The whisper hooks in here.
>   - TTS prompts: `constants/TtsPrompts.ts` — add whisper prompt templates.

## Architecture

There are two approaches to call whisper. **Option A** is simpler and recommended
for v1:

### Option A: Pre-ring whisper via FreeSWITCH early media (recommended)

1. Before `createB2BUA`, answer the callee's B-leg on a FreeSWITCH endpoint.
2. Speak the whisper to the callee (caller hears ring-back from the 180/183).
3. After the whisper finishes, bridge the caller to the callee.
4. If the callee presses `*` during the whisper → route to voicemail.

**Pro:** simple, uses the existing IVR pipeline, no WebRTC audio injection.
**Con:** adds 2–3 seconds of delay before the call actually rings.

### Option B: In-browser whisper overlay (advanced)

1. Ring the callee normally (B2BUA as-is).
2. When the browser shows the incoming-call UI, play a pre-synthesized audio
   clip (TTS via Deepgram/Speechmatics) into the browser's earpiece alongside
   the ringtone.
3. The whisper is generated server-side and sent as a URL in the WS
   `incoming_call` event.

**Pro:** no ring delay, parallel with the ringtone.
**Con:** requires client-side audio mixing, TTS latency for generating the clip.

> **Decision: start with Option A.** It's server-side, uses existing IVR
> infrastructure, and is reliable. Option B can be added later as an enhancement.

## Implementation (Option A — server-side whisper)

### Config / user preferences

- [ ] Extend `UserSettings` (Go): add `CallScreening bool
      gorm:"column:call_screening;default:false"`. Mirror to `SipUser` in Node
      via the existing settings sync.
- [ ] Env: `CALL_SCREENING_ENABLED` (default `false`) — global master switch.
      Per-user `callScreening` is the fine-grained control.
- [ ] Per-user setting in `SettingsScreen.tsx`: "Screen unknown callers" toggle.

### Whisper text generation

- [ ] New function `buildWhisperText(from, fromName, contactName?, isExternal)`:
      - Saved contact: *"Call from Bob Smith"*
      - Known extension user: *"Call from Alice Anderson, extension one zero zero one"*
      - Unknown PSTN: *"Call from plus one, five five five, one two three four"*
        (digits spoken individually for clarity)
      - Unknown internal: *"Call from extension one zero zero five"*
- [ ] Add whisper templates to `TtsPrompts.ts`:
      `WHISPER_KNOWN: "Call from {name}"`
      `WHISPER_UNKNOWN: "Call from {number}"`
      `WHISPER_SEND_TO_VM: "Press star to send to voicemail"`

### Call flow modification

- [ ] In `sip.server.ts` → `routeToExtension()` (or `InternalHandler.handle()`):
      **before** `createB2BUA()`:
      1. Check `config.callScreening.enabled && calleeUser.callScreening`.
      2. Check if caller is "unknown" (not in contacts, not a known extension, or
         external PSTN). If caller is a known/saved contact, optionally skip the
         whisper (configurable: `screenKnownCallers` bool).
      3. If screening applies:
         a. Answer the **callee's** leg on a FreeSWITCH MRF endpoint
            (`ms.connectCaller` to the callee side).
         b. Meanwhile, send `180 Ringing` to the **caller** (they hear ring-back).
         c. `endpoint.speak(whisperText)` — TTS the caller identity.
         d. Collect a single DTMF digit with a short timeout (3s):
            - `*` → route to voicemail (`ivr.recordVoicemail`), status `missed`.
            - Any other key or timeout → proceed with the normal B2BUA bridge.
         e. Release the MRF endpoint, proceed to `createB2BUA()`.
- [ ] **Caller experience**: during steps (a–e) the caller hears standard
      ring-back tone. They don't know screening is happening — from their
      perspective, the phone is just ringing.
- [ ] **Timing**: whisper is typically 2–3 seconds. The caller is hearing ringing
      during this time, so it feels normal (phones often ring 4–6 times before
      picking up). The 15s ring timeout in `createB2BUA` starts AFTER the whisper.

### WebSocket event enhancement

- [ ] Add `screening?: boolean` and `whisperText?: string` to the WS
      `incoming_call` event payload so the browser UI can show "Screening…" during
      the whisper phase.
- [ ] After the whisper is done and the call proceeds to ring, send a
      `screening_done` event so the UI switches to the normal ringing UI.

### Frontend

- [ ] `SettingsScreen.tsx`: add a "Call Screening" section:
      - Toggle: "Screen unknown callers" (on/off)
      - Toggle: "Screen all callers" (on/off) — even known contacts
      - Info text: "When enabled, you'll hear who's calling before the phone
        rings. Press * during the announcement to send to voicemail."
- [ ] Incoming call UI (`ActiveCallScreen.tsx` or the incoming-call overlay):
      when `screening === true`, show a "Screening…" badge and the whisper text
      so the user can also read it while hearing the audio.

## Advanced Enhancements (v2)

- [ ] **CNAM / reverse lookup**: for unknown PSTN numbers, query a CNAM database
      (e.g. Twilio Lookup API, `$0.005/lookup`) to get the registered name.
      Include the result in the whisper: *"Call from Acme Plumbing, plus one five
      five five…"*.
- [ ] **Spam detection**: query a spam database (Twilio Lookup with caller-name
      add-on, or a free API like SpamScore). If spam confidence is high, auto-send
      to voicemail without even whispering.
      *"Likely spam call from plus one…, sending to voicemail."*
- [ ] **Option B (in-browser whisper)**: pre-synthesize the whisper as an audio
      file (Deepgram TTS, ~200ms latency), send the URL in the WS event, and let
      the browser play it alongside the ringtone. No ring delay.
- [ ] **Whisper recording**: optionally record the whisper interaction (the
      caller's ring-back is not recorded — just the callee's whisper audio). Not
      very useful for v1.

## Guardrails / Edge Cases

- [ ] **IVR/MRF required**: call screening requires FreeSWITCH MRF to be running
      (it's the TTS engine). If MRF is not available, skip screening and ring
      normally — `try/catch` around the whisper, fail-open to normal ringing.
- [ ] **Performance**: the whisper adds 2–3 seconds. For a personal phone this is
      fine. For a call center this would be unacceptable — but this feature is
      single-user only.
- [ ] **Widget calls**: calls from the click-to-call widget should NOT be
      screened (they're already gated by API key). Check `isWidgetCall` and skip.
- [ ] **Internal calls**: optionally skip screening for internal extension-to-
      extension calls (you know who your own users are). Default: screen external
      only.
- [ ] **DND interaction**: if DND is on, calls go straight to voicemail — no
      screening (the user doesn't want to be bothered at all).
- [ ] **Forwarded calls**: if the call was forwarded from another extension, the
      whisper should mention the forwarding: *"Forwarded call from Bob Smith,
      originally to extension one zero zero two."*
