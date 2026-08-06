# Using `mod_audio_stream` with drachtio-fsmrf

How to fork a live call's audio out to a WebSocket and run it through an STT / AI
pipeline **inside this `src/` app** — the app that drives calls with
[`drachtio-srf`](https://github.com/drachtio/drachtio-srf) +
[`drachtio-fsmrf`](https://github.com/drachtio/drachtio-fsmrf).

There are two ways to drive `mod_audio_stream`. This app uses the **fsmrf**
style; the ESL style is documented in the standalone demo
([`docker/freeswitch-audiostream/example-app`](../../../docker/freeswitch-audiostream/example-app)).

| | fsmrf (this app) | ESL (example-app) |
|---|---|---|
| Get the channel | `ms.connectCaller(req,res)` → `Endpoint` | `<action application="socket">` → ESL conn |
| Start the fork | `endpoint.api('uuid_audio_stream', …)` | `conn.api('uuid_audio_stream …')` |
| Play audio back | `endpoint.play()` / `endpoint.speak()` | `conn.execute('speak'/'playback')` |

Both fork the **same** audio to a WebSocket; only the control channel differs.

---

## The pieces already in this repo

- **Media WS server** — [`media-stream.server.ts`](./media-stream.server.ts):
  `MediaStreamServer` listens on `streamingConfig.wsPort` and speaks the
  FreeSWITCH wire format via [`freeswitch.protocol.ts`](./freeswitch.protocol.ts)
  (selected with `?provider=freeswitch`).
- **Handler seam** — `MediaStreamHandlers` (`onStart` / `onAudio` / `onStop`)
  in [`types.ts`](./types.ts). The AI voice-agent implementation lives in
  [`ai/ai.handlers.ts`](./ai/ai.handlers.ts).
- **Media server / endpoints** — [`../../sip/ivr.system.ts`](../../sip/ivr.system.ts)
  already does `mrf.connect()` + `connectCaller()`; reuse that `Endpoint`.

## 1. Fork the call audio (fsmrf)

Once you have an answered `Endpoint` (from `connectCaller` or `createEndpoint`),
start the stream with the FreeSWITCH API. `endpoint.uuid` is the channel UUID.

```ts
import { streamingConfig } from "@/trunk/streaming/config";

async function startAudioStream(endpoint: Mrf.Endpoint) {
  const base = streamingConfig.publicWsUrl || `ws://127.0.0.1:${streamingConfig.wsPort}`;
  // ?provider=freeswitch selects the FreeSWITCH codec; token auth if configured.
  const qs = new URLSearchParams({ provider: "freeswitch" });
  if (streamingConfig.authToken) qs.set("token", streamingConfig.authToken);
  const url = `${base}/?${qs.toString()}`;

  // IMPORTANT: the metadata JSON is the FIRST frame the WS server sees, and
  // MediaStreamServer switches on `event`. It MUST be {"event":"start", ...}
  // or no session is created. Keep it compact (the api args are space-split).
  const meta = JSON.stringify({ event: "start", callId: endpoint.uuid });

  // uuid_audio_stream <uuid> start <ws-url> <mono|mixed|stereo> <rate> <meta>
  await endpoint.api(
    "uuid_audio_stream",
    `${endpoint.uuid} start ${url} mono 8000 ${meta}`,
  );
}
```

Use **`mono`** (caller only) for STT — it never picks up the AI's own voice.
`stereo` gives caller (left) + callee (right); if you need both, de-interleave
channel 0 for STT (see `extractCaller` in the example-app's `audio/channels.ts`).

> `mod_audio_stream` frames are **L16 PCM, native little-endian** at the rate you
> requested (here 8 kHz). No byte-swap is needed.

Stop it when the call ends (also happens automatically on hangup):

```ts
await endpoint.api("uuid_audio_stream", `${endpoint.uuid} stop`);
```

## 2. Receive the audio + run STT

`MediaStreamServer` decodes frames and calls your `MediaStreamHandlers`. Wire STT
in `onAudio` (or reuse the ready-made AI handlers):

```ts
import { MediaStreamServer } from "@/trunk/streaming/media-stream.server";
import type { MediaStreamHandlers } from "@/trunk/streaming/types";

const handlers: MediaStreamHandlers = {
  onStart: (session, meta) => {/* open your STT stream for meta.callId */},
  onAudio: (session, frame) => {/* frame.audio = L16 PCM -> feed STT */},
  onStop:  (session)        => {/* close STT, flush transcript */},
};

new MediaStreamServer(handlers).start(); // listens on streamingConfig.wsPort
```

For a full agent (STT → LLM → TTS) use `createAiHandlers(brain)` /
`createAgentAwareHandlers(resolve)` from [`ai/ai.handlers.ts`](./ai/ai.handlers.ts)
instead of writing `onAudio` by hand.

## 3. Talk back into the call

`mod_audio_stream` (community edition) is **stream-out only** — you cannot push
audio back over the WS. Play responses through the fsmrf `Endpoint`:

```ts
await endpoint.speak({ text: "How can I help you?", vendor: "…", voice: "…" });
// or a synthesized/pre-rendered file:
await endpoint.play("/path/to/reply.wav");
```

## Configuration

Set in the environment (see [`config.ts`](./config.ts)):

| Var | Meaning |
|-----|---------|
| `MEDIA_STREAM_ENABLED` | Master switch for the media-streaming subsystem |
| `MEDIA_STREAM_WS_PORT` | Port `MediaStreamServer` listens on (`wsPort`, default 3004) |
| `MEDIA_STREAM_PUBLIC_URL` | Public `ws(s)://` base FreeSWITCH dials back; empty → `ws://127.0.0.1:<wsPort>` |
| `MEDIA_STREAM_AUTH_TOKEN` | Shared secret validated as `?token=` on the handshake |

FreeSWITCH must reach `MEDIA_STREAM_PUBLIC_URL`. In Docker use the app's
service name (e.g. `ws://app:<wsPort>`), not `localhost`.

## End-to-end flow

```
INVITE ─▶ ms.connectCaller(req,res) ─▶ Endpoint(answered)
             │
             ├─ endpoint.api('uuid_audio_stream <uuid> start <ws> mono 8000 {event:start,…}')
             │        │
             │        ▼   (L16 PCM frames)
             │   MediaStreamServer  ─▶ freeswitch.protocol ─▶ MediaStreamHandlers.onAudio ─▶ STT ─▶ LLM
             │                                                                                      │
             └─ endpoint.speak()/play()  ◀───────────────────  TTS  ◀──────────────────────────────┘
```

## Prerequisites

FreeSWITCH must have `mod_audio_stream` loaded. The image in
[`docker/freeswitch-audiostream`](../../../docker/freeswitch-audiostream) builds
it from source; verify with:

```bash
docker exec <fs-container> fs_cli -x 'module_exists mod_audio_stream'   # -> true
docker exec <fs-container> fs_cli -x 'show api' | grep uuid_audio_stream
```
