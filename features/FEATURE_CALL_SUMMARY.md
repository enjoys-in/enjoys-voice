# Call Summary / Notes (AI-Powered)

> **Goal:** after a call ends, automatically generate a short summary of the
> conversation using the existing STT + LLM pipeline. Also allow manual notes per
> call. Summaries are stored in call history and are searchable.
>
> **What already exists to build on:**
>   - Call recording: FreeSWITCH records calls; recordings are stored as WAV files.
>     `call_records` has a `recording_url` / `recording_path` field.
>   - STT providers: Deepgram and Speechmatics batch APIs (same as voicemail
>     transcription — `FEATURE_VOICEMAIL_TRANSCRIPTION.md`).
>   - LLM providers: OpenAI (`gpt-4o-mini`) and Gemini (`gemini-1.5-flash`)
>     already integrated in `src/agents/`. API keys in env.
>   - Call records: `call_records` table in Postgres, `CallLog` in Node
>     (`src/core/types.ts`), call history in `CallsScreen.tsx`.
>   - AI agent pipeline: `speech → LLM → speech` already wired. This feature
>     reuses STT + LLM only (no TTS).
>   - `TranscriptionService` (from voicemail transcription feature) — reuse for
>     the STT step.

## Data Model

- [ ] Extend `CallRecord` in Go (`server/internal/models/call.go`):
      ```go
      Transcript string    `gorm:"column:transcript;type:text"`
      Summary    string    `gorm:"column:summary;type:text"`
      Notes      string    `gorm:"column:notes;type:text"`
      SummarizedAt *time.Time `gorm:"column:summarized_at"`
      ```
      AutoMigrate adds the columns.
- [ ] Extend `CallLog` in Node (`src/core/types.ts`):
      ```ts
      transcript?: string;
      summary?: string;
      notes?: string;
      summarizedAt?: string;
      ```

## Summarization Pipeline (Node — post-call)

- [ ] New `CallSummaryService` (`src/services/call-summary.service.ts`):

### Step 1: Transcribe the recording

- [ ] `transcribe(recordingPath: string, language?: string): Promise<string>`
      — reuse `TranscriptionService` from the voicemail transcription feature.
      Same Deepgram/Speechmatics batch API. For longer calls (> 5 min), this may
      take 10–30 seconds — always async.

### Step 2: Summarize with LLM

- [ ] `summarize(transcript: string, metadata: CallMeta): Promise<string>`
      — send the transcript + call metadata to the LLM for summarization.
- [ ] LLM prompt:
      ```
      Summarize this phone call in 1-3 sentences. Include the key topics discussed,
      any decisions made, and action items. Be concise.

      Call details:
      - From: {fromName} ({from})
      - To: {toName} ({to})
      - Duration: {duration}
      - Date: {date}

      Transcript:
      {transcript}
      ```
- [ ] Provider: use the configured `CALL_SUMMARY_LLM_PROVIDER` (default `openai`,
      model `gpt-4o-mini`). Reuse the existing LLM client code from `src/agents/`.
- [ ] Temperature: `0.3` (factual, low creativity).
- [ ] Max tokens: `200` (summaries should be short).

### Step 3: Persist

- [ ] Update the call record in Postgres:
      `UPDATE call_records SET transcript = $1, summary = $2, summarized_at = NOW()
      WHERE call_id = $3`.
- [ ] Push to the browser via WS:
      `{ type: 'call_summarized', callId, summary, transcript }`.

### Trigger

- [ ] After a call ends with `status = 'ended'` AND `duration > 30` (don't
      summarize 5-second calls) AND the call was recorded:
      ```ts
      // in updateCall() or a post-call hook:
      if (config.callSummary.enabled && call.status === 'ended' && call.duration > 30 && call.recordingPath) {
        callSummaryService.process(call)
          .catch(err => console.warn('⚠️ Call summary failed:', err.message));
      }
      ```
- [ ] **Async, fire-and-forget**: never block call teardown. A failed summary
      just means the field stays null.
- [ ] **Idempotent**: guard with `summarizedAt` — don't re-summarize a call that
      already has a summary.

## Manual Notes

- [ ] Separate from auto-summary: the user can add/edit free-text notes on any
      call, regardless of whether it was recorded or summarized.
- [ ] Go API: `PATCH /api/g/calls/:callId/notes` — body `{ notes: "..." }`.
      Owner-scoped (JWT extension must match `from_ext` or `to_ext`).
- [ ] Frontend: in the call detail view or the recents list, a "Notes" field
      with an inline edit (click to type, auto-save on blur).

## Go API Surface

- [ ] Extend `GET /api/g/calls` and `GET /api/g/calls/:ext` responses to include
      `transcript`, `summary`, `notes`, `summarizedAt`.
- [ ] `PATCH /api/g/calls/:callId/notes` — update notes (owner-scoped).
- [ ] `POST /api/g/calls/:callId/summarize` — manually trigger summarization for
      a specific call (if it has a recording but wasn't auto-summarized). Calls
      the Node engine's summarization endpoint or queues it.
- [ ] `GET /api/g/calls/search?q=project+deadline` — full-text search across
      `summary`, `transcript`, and `notes`. Use Postgres `tsvector` / `to_tsquery`
      for efficient search, or simple `ILIKE` for v1.

## Frontend

- [ ] **CallsScreen.tsx** (recents): show a small summary preview under each call
      entry (truncated to 1 line, expandable). If no summary, show nothing.
- [ ] **Call detail modal/panel**: full summary, full transcript (collapsible),
      editable notes textarea, and a "Regenerate summary" button.
- [ ] **Search**: add a search bar to the recents screen that searches across
      summary/transcript/notes text via the Go API.
- [ ] `go-api.ts`: add `calls.updateNotes(callId, notes)` and
      `calls.search(query)`.

## Config

- [ ] Env vars:
      - `CALL_SUMMARY_ENABLED` (default `false`) — master switch.
      - `CALL_SUMMARY_LLM_PROVIDER` (default `openai`) — `openai` | `gemini`.
      - `CALL_SUMMARY_LLM_MODEL` (default `gpt-4o-mini`).
      - `CALL_SUMMARY_STT_PROVIDER` (default `deepgram`) — reuse voicemail STT
        provider if set.
      - `CALL_SUMMARY_MIN_DURATION` (default `30`) — minimum call duration in
        seconds to trigger auto-summarization.
      - Reuses existing `OPENAI_API_KEY`, `GEMINI_API_KEY`, `DEEPGRAM_API_KEY`.

## Guardrails / Edge Cases

- [ ] **Cost**: Deepgram STT ~$0.0043/min + OpenAI gpt-4o-mini ~$0.15/1M input
      tokens. A 5-minute call ≈ $0.02 STT + $0.01 LLM = ~$0.03. For personal use
      (5–10 calls/day) this is ~$0.30/day. Log per-call cost.
- [ ] **Long calls**: a 60-minute call transcript could be ~15,000 words
      (~20k tokens). gpt-4o-mini handles 128k context, so it's fine. For very
      long calls, chunk the transcript if it exceeds the model's context.
- [ ] **Privacy**: transcripts contain call content. Same access controls as call
      recordings. Only the call participants can see the summary/transcript.
- [ ] **Recording availability**: not all calls are recorded (recording is opt-in
      or per-IVR-flow). Only summarize calls that have a recording file.
- [ ] **Dual-channel recording**: if both sides are recorded in separate channels,
      Deepgram supports multi-channel transcription with speaker diarization.
      Use `channels=2&multichannel=true` for better "Speaker 1 / Speaker 2"
      attribution.
- [ ] **Manual notes vs auto-summary**: keep them separate. The user's notes are
      never overwritten by auto-summarization. Both are shown in the UI.
