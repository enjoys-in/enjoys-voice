# ENJOYS AudioStream App

TypeScript service that bridges **FreeSWITCH `mod_audio_stream`** (caller audio out)
and **Outbound Event Socket (ESL)** (control + Piper TTS back into the call) to build
a bidirectional AI voice gateway. Class-based with SOLID boundaries, compiled with
**SWC**, wired through a single composition root.

## Architecture

```
src/
  index.ts                 Composition root — wires concrete impls (DI)
  config/index.ts          Env-driven typed AppConfig (12-factor)
  core/
    interfaces.ts          Abstractions (ILogger, ICallRegistry, IAudioCodec,
                           IRecorder/IRecorderFactory, ITtsService, IServer)
    types.ts               Domain + ESL types (AppConfig, EslConnection)
    Logger.ts              ConsoleLogger (scoped)
  domain/CallRegistry.ts   UUID -> live ESL connection
  audio/
    L16Codec.ts            Normalizes mod_audio_stream frames to LE PCM
    WavRecorderFactory.ts  Per-call WAV recorder (Factory)
  tts/EslTtsService.ts     speak() back into a call over ESL
  application/CallController.ts   Call lifecycle: answer -> stream -> greet
  transport/
    HttpServer.ts          Express: softphone UI + /say + /calls + /health
    AudioStreamServer.ts   WS receiver for forked caller audio
    EslCallServer.ts       Outbound ESL server
```

Ports: **3000** (Web UI + API), **8080** (audio WS), **8085** (ESL).

## Develop

```bash
npm install
npm run typecheck   # tsc --noEmit
npm run build       # SWC -> dist/ (path aliases @/* resolved)
npm start           # node dist/index.js
npm run dev         # nodemon: rebuild + run on change
```

Path alias `@/*` maps to `src/*` (see `tsconfig.json` + `.swcrc`).

## Configuration

All via environment variables (see [.env.example](.env.example)); every value has a
safe default:

| Var | Default | Notes |
|-----|---------|-------|
| `HTTP_PORT` / `WS_PORT` / `ESL_PORT` | 3000 / 8080 / 8085 | |
| `WS_HOST_FOR_FS` | `node-app` | host FreeSWITCH dials for the audio WS |
| `AUDIO_CHANNELS` / `AUDIO_SAMPLE_RATE` | `mono` / `8000` | must match `uuid_audio_stream` |
| `AUDIO_SWAP_ENDIANNESS` | `false` | set `true` only if recordings sound like static |
| `RECORDING_ENABLED` / `RECORDING_DIR` | `true` / `public` | served at `/recording_*.wav` |
| `TTS_VOICE` / `TTS_GREETING` | `en_US-amy-medium` / … | Piper voice + greeting |

## Docker

Built and run by the top-level [docker-compose.yml](../docker-compose.yml): the
`node-app` service builds this folder's [Dockerfile](Dockerfile) (SWC compiles the TS
inside the Linux image). `public/` is mounted so UI edits and recordings live on the
host.

```bash
cd ..                            # docker/freeswitch-audiostream
docker compose up -d --build node-app
```

## How a call flows

1. Browser registers to FreeSWITCH over WebRTC (`ws://localhost:5066`) and dials `9999`.
2. The dialplan `socket` app connects the call's Outbound ESL to `node-app:8085`.
3. `CallController` answers, starts `uuid_audio_stream` (caller audio →
   `ws://node-app:8080/<uuid>`), then greets via Piper TTS.
4. `AudioStreamServer` records the caller audio (wire your STT/VAD into the `AudioSink`);
   reply into the live call with `POST /say {uuid,text}` or `ITtsService.speak()`.

## API

- `POST /say` — `{ "uuid": "...", "text": "...", "voice": "en_US-amy-medium" }`
- `GET /calls` — active call UUIDs
- `GET /health` — liveness
