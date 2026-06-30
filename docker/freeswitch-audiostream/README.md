# FreeSWITCH + `mod_audio_stream` (standalone, built from source)

A **self-contained** FreeSWITCH image that bakes in
[`mod_audio_stream`](https://github.com/amigniter/mod_audio_stream) — a WebSocket
client inside FreeSWITCH that **forks live call audio out to a `ws://…` endpoint**
(L16 PCM, 8 k/16 k). It's the open-source alternative to `mod_audio_fork`, and is
the module shown in the AI-voice architecture diagram feeding the STT/VAD gateway.

It also carries everything from the published **`mullayam06/freeswitch-piper`**
image — **Piper neural TTS** wired through `mod_tts_commandline` and set as the
default TTS engine — so `speak`/`say` produce natural, self-hosted (no-cloud,
no-key) audio out of the box.

> **Why this is a separate image (not an overlay).** `mod_audio_stream` is a
> *compiled* module and must be built against the FreeSWITCH ABI it runs on. Our
> normal media image ([../freeswitch-custom](../freeswitch-custom)) is built on
> `safarov/freeswitch`, a **minified** rootfs with no compiler, headers or apt —
> you can't build the module inside it. This image therefore **builds FreeSWITCH
> 1.10.x from source** (no SignalWire token needed) and compiles the module
> against it.

## Edition / scope

- **Community edition, uni-directional** — streams audio **out** of the call to
  your WebSocket (perfect for STT / VAD / transcription).
- Playing audio **back into** the call (bidirectional / "streamAudio" playback) is
  the **commercial edition** of `mod_audio_stream` (free up to 10 concurrent
  channels). This image does **not** enable it. For TTS playback today, keep using
  the existing media-stream path or play files via ESL (`uuid_broadcast`).

## Build

```bash
cd docker/freeswitch-audiostream
./run.sh            # build (slow — compiles FreeSWITCH + deps from source)
./run.sh --up       # build, run a throwaway container, and verify the module
```

Override the pinned versions if needed:

```bash
FS_VERSION=v1.10.11 MOD_AUDIO_STREAM_REF=v1.0.0 ./run.sh
# Different Piper voice / ARM host:
PIPER_ARCH=aarch64 PIPER_VOICE=en_US-ryan-high PIPER_VOICE_PATH=en/en_US/ryan/high ./run.sh
```

What the build does (multi-step, see [Dockerfile](Dockerfile)):

1. Installs the Debian toolchain + FreeSWITCH/​module dependencies.
2. Builds the SignalWire libs not packaged by Debian — **libks**, **signalwire-c**,
   **sofia-sip**, **spandsp** — from source.
3. Builds **FreeSWITCH `${FS_VERSION}`** to `/usr/local/freeswitch` (mod_av / mod_cv /
   mod_shout / mod_flite disabled; **mod_tts_commandline enabled**).
4. Builds **`mod_audio_stream`** (+ its `libwsc` submodule) against that install.
5. Fetches **Piper** + a voice model and wires it as the default TTS engine.
6. Adds `<load module="mod_audio_stream"/>` and `<load module="mod_tts_commandline"/>`
   to `modules.conf.xml`.

## Verify

```bash
docker exec <ctr> fs_cli -x 'module_exists mod_audio_stream'     # -> true
docker exec <ctr> fs_cli -x 'module_exists mod_tts_commandline'  # -> true (Piper)
docker exec <ctr> fs_cli -x 'show api' | grep uuid_audio_stream
```

## Use it

Attach a media bug to a live channel and stream its audio to your gateway:

```text
uuid_audio_stream <uuid> start ws://<gateway-ip>:2700/<uuid> mono 16k '{"callId":"<uuid>"}'
uuid_audio_stream <uuid> pause
uuid_audio_stream <uuid> resume
uuid_audio_stream <uuid> send_text '{"event":"hangup"}'
uuid_audio_stream <uuid> stop
```

- `mix-type` — `mono` (caller) · `mixed` (caller+callee) · `stereo` (two channels)
- `sampling-rate` — `8k` · `16k`
- The module fires `mod_audio_stream::{connect,disconnect,json,error,play}` events
  on the FreeSWITCH event bus; subscribe over ESL to react to server responses.

From the dialplan instead of the API:

```xml
<action application="audio_stream" data="start ws://gateway:2700/${uuid} mono 16k"/>
```

### Useful channel variables

| Variable | Effect |
| --- | --- |
| `STREAM_BUFFER_SIZE` | audio chunk duration in ms (multiple of 20; default 20) |
| `STREAM_EXTRA_HEADERS` | JSON object of extra HTTP headers on the WS handshake |
| `STREAM_HEART_BEAT` | seconds between idle keepalive pings |
| `STREAM_SUPPRESS_LOG` | `true`/`1` to stop printing WS responses to the log |
| `STREAM_NO_RECONNECT` | `true`/`1` to disable auto-reconnect |
| `STREAM_TLS_CA_FILE` | CA bundle for `wss://` (`SYSTEM` default, or `NONE`) |

## Text-to-speech (Piper)

Piper is wired as the **default** TTS engine, so the standard `speak` app / `say`
just work:

```xml
<action application="speak" data="say:Hello, you have reached the AI line."/>
```

```text
fs_cli> uuid_speak <uuid> tts_commandline|en_US-amy-medium|Welcome to CallNet
```

- The default voice is `en_US-amy-medium` (override at build with `PIPER_VOICE` /
  `PIPER_VOICE_PATH`). Models live at `/opt/piper/voices/<voice>.onnx`.
- **Hindi voices** are also baked in: `hi_IN-rohan-medium` and
  `hi_IN-priyamvada-medium`. Use them per call without changing the default, e.g.

  ```text
  fs_cli> uuid_speak <uuid> tts_commandline|hi_IN-rohan-medium|नमस्ते, CallNet में आपका स्वागत है
  fs_cli> uuid_speak <uuid> tts_commandline|hi_IN-priyamvada-medium|नमस्ते
  ```

  Bake more/other voices via the `PIPER_EXTRA_VOICES` build-arg (space-separated
  `<lang>-<voice>-<quality>` keys; the HuggingFace path is derived automatically):

  ```bash
  PIPER_EXTRA_VOICES="hi_IN-rohan-medium hi_IN-priyamvada-medium hi_IN-pratham-medium" ./run.sh
  ```
- TTS config is at
  [config/tts_commandline.conf.xml](config/tts_commandline.conf.xml) (baked to
  `/usr/local/freeswitch/conf/autoload_configs/`). Bind-mount your own to override.

## Notes

- This is a **demonstration / gateway** image: it ships a stock vanilla config
  (ESL on `8021`, default `ClueCon` password). Harden the password and config
  before any non-local use, and bind/firewall ESL appropriately.
- The image is large (it carries the from-source FreeSWITCH and its build deps).
  It can be slimmed later with a multi-stage runtime copy if size matters.
- The pinned dependency branches (libks / signalwire-c / sofia-sip / spandsp) track
  upstream `master`; pin them to tags if you need fully reproducible builds.
