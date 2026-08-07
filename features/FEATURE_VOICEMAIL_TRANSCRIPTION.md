# Voicemail Transcription

> **Goal:** after a voicemail is recorded, automatically transcribe it using an
> existing STT provider (Deepgram or Speechmatics — already integrated for the AI
> voice agent). Store the transcript alongside the audio and display it in the web
> UI so voicemails can be *read* without listening.
>
> **What already exists to build on:**
>   - Voicemail recording: `IvrSystem.recordVoicemail()` (`src/sip/ivr.system.ts`)
>     records via FreeSWITCH MRF, saves a WAV, inserts into `voicemails` table via
>     `db.addVoicemail()`.
>   - STT providers: `src/agents/deepgram/` and `src/agents/speechmatics/` — both
>     support **batch** (file upload) and **real-time** (WebSocket streaming) modes.
>     For voicemail we want **batch** (the recording is already a complete file).
>   - Voicemail model: `Voicemail` type (`src/core/types.ts`) has `id`, `mailbox`,
>     `from`, `fromName`, `filename`, `duration`, `read`, `createdAt`.
>   - Voicemail UI: `VoicemailScreen.tsx` — list with play/delete/call-back.
>   - Voicemail API: Node `GET /api/n/voicemails/:ext` + Go `GET /api/g/voicemails/:ext`.
>   - Push service: can push the transcript in the notification body.
>   - Email connector (`src/services/mailer.ts`): can email the transcript.

## Data Model

- [ ] Add `transcript TEXT` column to the `voicemails` table (Postgres). Additive
      migration — Go AutoMigrate picks it up from the `Voicemail` GORM model.
      Go model (`server/internal/models/`) — add `Transcript string` field.
- [ ] Add `transcript?: string` to the `Voicemail` type in `src/core/types.ts`.
- [ ] Add `transcriptionStatus?: 'pending' | 'done' | 'failed'` to the type
      (not persisted — derived: `transcript` present = done, null = pending/none).
      Optional: persist a `transcription_status` column if you want to distinguish
      "never attempted" from "attempted and failed".

## Transcription Pipeline (Node — post-record)

- [ ] New `TranscriptionService` (`src/services/transcription.service.ts`):
      - `transcribe(filePath: string, language?: string): Promise<string>` — reads
        the WAV file, sends it to the configured STT provider, returns the text.
      - Provider selection: `VOICEMAIL_STT_PROVIDER` env (default `deepgram`,
        options `deepgram` | `speechmatics`). Falls back gracefully if the key is
        missing.
      - **Deepgram batch**: `POST https://api.deepgram.com/v1/listen` with the
        audio file as the body, `Authorization: Token <DEEPGRAM_API_KEY>`. Query
        params: `model=nova-2`, `language=<lang>`, `punctuate=true`,
        `smart_format=true`. Response: `results.channels[0].alternatives[0].transcript`.
      - **Speechmatics batch**: `POST https://asr.api.speechmatics.com/v2/jobs`
        with a multipart form (audio file + JSON config). Poll for completion.
        Alternatively use the real-time WS to stream the file for faster results.
- [ ] **Hook into voicemail save**: in `IvrSystem.recordVoicemail()`, after
      `db.addVoicemail(vm)`, fire an **async** transcription job. Don't block
      the call teardown — the caller has already hung up.
      ```
      // after db.addVoicemail(vm):
      if (config.voicemail.transcription) {
        this.transcriptionService
          .transcribe(fullPath, config.voicemail.language)
          .then(text => db.updateVoicemailTranscript(vm.id, vm.mailbox, text))
          .catch(err => console.warn('⚠️ Voicemail transcription failed:', err.message));
      }
      ```
- [ ] `DatabaseService.updateVoicemailTranscript(id, mailbox, text)` — new method,
      delegates to a Postgres UPDATE (`UPDATE voicemails SET transcript = $1
      WHERE id = $2 AND mailbox = $3`).
- [ ] After transcript is saved, **push to the browser** via WS signalling:
      `{ type: 'voicemail_transcribed', id, transcript }`. The web client
      updates the voicemail in the store without a refetch.

## Go API Changes

- [ ] Extend `Voicemail` GORM model with `Transcript string
      gorm:"column:transcript"` — AutoMigrate adds the column.
- [ ] Extend the voicemail list/detail response to include `transcript` (already
      present in the serialized model if the field is added).
- [ ] No new endpoints needed — transcript is just a new field on the existing
      voicemail responses.

## Frontend

- [ ] `VoicemailScreen.tsx` — show the transcript below each voicemail entry:
      - If `vm.transcript` exists, show it as a light-gray text block under the
        from/time line. Truncate to 2 lines with "Show more" expand.
      - If transcript is absent, show nothing (or a subtle "Transcribing…"
        spinner if `transcriptionStatus === 'pending'`).
- [ ] Voicemail store (`voicemail.store.ts`) — handle the `voicemail_transcribed`
      WS event: find the voicemail by id, set `transcript`.
- [ ] Voicemail type in `web/app/types/` — add `transcript?: string`.

## Notifications (optional but high-value)

- [ ] **Push notification with transcript**: when the mobile push for a new
      voicemail is sent, include the transcript in the notification body so the
      user can read it on the lock screen without opening the app.
- [ ] **Email notification**: if an email connector is configured, send an email
      on new voicemail with the transcript in the body + a link to playback.
      Reuse `sendConnectorEmail` from `src/services/mailer.ts`.

## Config

- [ ] New env vars:
      `VOICEMAIL_TRANSCRIPTION` (default `false`) — master switch.
      `VOICEMAIL_STT_PROVIDER` (default `deepgram`) — which STT to use.
      `VOICEMAIL_STT_LANGUAGE` (default `en`) — language hint for STT.
      The provider API key is already configured (`DEEPGRAM_API_KEY` or
      `SPEECHMATICS_API_KEY`) — reuse the same env vars as the AI agent.

## Guardrails / Edge Cases

- [ ] **Async, never blocking**: transcription runs AFTER the voicemail is saved
      and the caller has disconnected. A failure must never prevent the voicemail
      from being stored.
- [ ] **Cost**: Deepgram Nova-2 is ~$0.0043/min (pre-recorded). A 60s voicemail
      costs < $0.01. Negligible for personal use, but log usage.
- [ ] **Empty / silent recordings**: STT returns an empty string. Store it as-is
      (the UI shows "No speech detected" or simply hides the transcript block).
- [ ] **File format**: voicemails are 16 kHz mono PCM WAV (FreeSWITCH canonical).
      Both Deepgram and Speechmatics accept WAV natively — no transcoding needed.
- [ ] **Retry**: if the STT API is temporarily down, optionally queue the job for
      a single retry. Don't retry indefinitely — log and move on. The user can
      always listen to the audio.
- [ ] **Privacy**: transcripts are stored in the same Postgres DB as the audio
      metadata. Same access controls apply. The STT provider processes the audio
      externally — same trade-off as the AI voice agent.
