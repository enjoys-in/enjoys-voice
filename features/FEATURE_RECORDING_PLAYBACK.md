# Call Recording Playback in Browser

> **Goal:** list call recordings in the recents/history view with an in-browser
> audio player and download button. Currently recordings are saved by FreeSWITCH
> but there may be no UI to play them back.
>
> **What already exists to build on:**
>   - Call recording: FreeSWITCH records calls to WAV files. The recording path
>     is stored in `call_records` (or a related `recordings` table).
>   - Recording model: `server/internal/models/recording.go` — Go model for
>     recordings with `CallID`, `FilePath`, `Duration`, etc.
>   - Recording handler: `server/internal/handler/` — may have endpoints for
>     listing/serving recordings.
>   - Voicemail playback: `VoicemailScreen.tsx` already has in-browser WAV
>     playback with play/pause, caching, and blob URL management. **Reuse this
>     pattern exactly.**
>   - Call history: `CallsScreen.tsx` shows call records with direction, status,
>     duration, timestamp.
>   - Node API: `GET /api/n/voicemails/:ext/:id/audio` streams WAV — the
>     recording endpoint should follow the same pattern.

## API Endpoints

- [ ] `GET /api/g/recordings` — list all recordings for the authenticated user.
      Filter by `from_ext` or `to_ext` matching the JWT extension.
      Response: `[{ id, callId, from, to, duration, createdAt, fileSize }]`.
- [ ] `GET /api/g/recordings/:id/audio` — stream the recording WAV file.
      Content-Type: `audio/wav`. Owner-scoped (user must be a party to the call).
- [ ] `DELETE /api/g/recordings/:id` — delete a recording (owner-scoped). Remove
      the file from disk + the DB row.
- [ ] Alternatively, if recordings are served by the Node engine:
      `GET /api/n/recordings/:callId/audio` — same pattern as voicemail audio.

## Frontend

### CallsScreen.tsx — Recording Indicator

- [ ] Show a small 🔴 recording icon next to calls that have a recording.
- [ ] The call record should include `hasRecording: boolean` or
      `recordingId?: string` in the API response.

### Recording Playback (inline or modal)

- [ ] When the user taps the recording icon on a call, expand an inline audio
      player below the call entry (or open a modal).
- [ ] Audio player features (reuse `VoicemailScreen` playback pattern):
      - Play / Pause button
      - Progress bar / seek slider
      - Current time / total duration display
      - Download button (`<a href="..." download>`)
- [ ] **Waveform visualization** (optional, premium feel):
      - Use the Web Audio API `AnalyserNode` to render a waveform while playing.
      - Or use a library like `wavesurfer.js` for a pre-rendered waveform.
      - Keep it lightweight — a simple amplitude bar visualization is enough.
- [ ] **Caching**: reuse the `voicemail-cache.ts` Cache Storage pattern. First
      play fetches + caches; subsequent plays are served from the cache.

### Zustand Store

- [ ] Extend `call.store.ts` or create `recording.store.ts`:
      - `playingRecordingId`, `audioRef`, `objectUrlRef` (same pattern as
        voicemail store).
      - `togglePlayRecording(callId)` — fetch, cache, play.
      - `downloadRecording(callId)` — trigger a download.

## Guardrails / Edge Cases

- [ ] **File size**: call recordings can be large (1 min ≈ 1.9 MB WAV 16kHz mono).
      A 30-min call is ~57 MB. Consider:
      - Streaming (`Range` header support) so the browser doesn't download the
        whole file before playing.
      - Converting to compressed format (MP3/OGG) server-side for playback (keep
        WAV as the archive). Or transcode on-the-fly with ffmpeg.
- [ ] **Access control**: recordings contain sensitive call content. Only the call
      participants (from_ext / to_ext) can access the recording. Enforce in the
      API endpoint.
- [ ] **Storage cleanup**: old recordings accumulate. Add a retention policy
      config (`RECORDING_RETENTION_DAYS`, default 90). A cron job / Go worker
      deletes recordings older than the retention period.
- [ ] **Dual-channel**: if both sides are recorded separately, merge them for
      playback (ffmpeg `amerge`) or play them as stereo (left = caller, right =
      callee). Stereo is useful for transcription diarization.
- [ ] **Missing file**: if the recording file is missing from disk (manually
      deleted, disk failure), show "Recording unavailable" instead of an error.
