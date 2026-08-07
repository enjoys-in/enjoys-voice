# FreeSWITCH (custom) — Piper neural TTS

A thin image built **on top of** `safarov/freeswitch:latest` that adds
[Piper](https://github.com/rhasspy/piper) — a self-hosted, neural Text‑To‑Speech
engine — so IVR/voicemail prompts sound natural instead of the robotic stock
`mod_flite` voice.

> Fully **internal**: no cloud, no API keys, no per-character cost.

## Run straight from Docker Hub

The image is published as `mullayam06/freeswitch-piper`. You don't need to build
anything — just pull and run.

```bash
docker pull mullayam06/freeswitch-piper:latest
```

### With `docker run` (all ports mapped)

```bash
docker run -d \
  --name drachtio-freeswitch \
  --cap-add SYS_NICE \
  --add-host host.docker.internal:host-gateway \
  -e SOUND_RATES=8000:16000 \
  -e SOUND_TYPES=music:en-us-callie \
  -p 8021:8021 \
  -p 5090:5090/udp \
  -p 5090:5090/tcp \
  -p 16384-16403:16384-16403/udp \
  -v "$(pwd)/../freeswitch_configs:/etc/freeswitch" \
  -v "$(pwd)/../freeswitch_sounds:/usr/share/freeswitch/sounds" \
  -v "$(pwd)/../recordings:/usr/local/freeswitch/recordings" \
  mullayam06/freeswitch-piper:latest
```

### Ports

| Host → Container | Proto | Purpose |
|------------------|-------|---------|
| `8021:8021` | tcp | ESL (Event Socket) — control/CLI |
| `5090:5090` | udp + tcp | MRF SIP (`drachtio_mrf` profile) |
| `16384-16403:16384-16403` | udp | RTP media |

> If you run FreeSWITCH **standalone** (without the drachtio front-end) and need
> its own SIP edge, also publish `-p 5060:5060/udp -p 5060:5060/tcp`. In this
> stack SIP `5060` lives on the `drachtio-server` container, so it's not mapped
> here.

### Or with Docker Compose

```yaml
services:
  drachtio-freeswitch:
    image: mullayam06/freeswitch-piper:latest
    container_name: drachtio-freeswitch
    cap_add:
      - SYS_NICE
    extra_hosts:
      - "host.docker.internal:host-gateway"
    environment:
      - SOUND_RATES=8000:16000
      - SOUND_TYPES=music:en-us-callie
    ports:
      - "8021:8021"                   # ESL (Event Socket)
      - "5090:5090/udp"               # MRF SIP (drachtio_mrf profile)
      - "5090:5090/tcp"
      - "16384-16403:16384-16403/udp" # RTP media
    volumes:
      - ./freeswitch_configs:/etc/freeswitch
      - ./freeswitch_sounds:/usr/share/freeswitch/sounds
      - ./recordings:/usr/local/freeswitch/recordings
    restart: unless-stopped
```

The bind-mounts are optional but recommended: they supply your dialplan/SIP
profiles, sound files and recording output. Without them the image still boots
with **Piper as the default TTS engine** (voice `en_US-amy-medium`) — it's baked
in, so a freshly pulled image speaks with Piper out of the box, no config needed.

The image also bakes in two **Hindi** voices — `hi_IN-rohan-medium` and
`hi_IN-priyamvada-medium` — selectable per call (e.g.
`tts_commandline|hi_IN-rohan-medium|नमस्ते`) or as the default via `TTS_VOICE`.
Bake more/other voices at build time with the `PIPER_EXTRA_VOICES` build-arg
(space-separated `<lang>-<voice>-<quality>` keys), or live-install into a running
container with [`add-voice.sh`](#4-add-extra-voices-any-language-with-add-voicesh).

**How the default works (and how to override it):** the base image copies its
vanilla configs into `/etc/freeswitch` on first start, so we bake the Piper
wiring into that vanilla source — `mod_tts_commandline` is enabled, pointed at
the Piper binary, and `vars.xml` sets `tts_engine=tts_commandline` +
`tts_voice=en_US-amy-medium`. To override, just bind-mount your own configs: if
you mount a full `/etc/freeswitch` (containing `freeswitch.xml`) the image skips
the vanilla copy entirely and uses yours; mounting a single file on top of
`/etc/freeswitch/autoload_configs/tts_commandline.conf.xml` shadows just that file.

> **Don't have the repo?** Grab the `freeswitch_configs` from GitHub:
> <https://github.com/enjoys-in/enjoys-voice/tree/main/docker/freeswitch_configs>
>
> ```bash
> # sparse-clone just the config dir
> git clone --depth 1 --filter=blob:none --sparse \
>   https://github.com/enjoys-in/enjoys-voice.git
> cd enjoys-voice
> git sparse-checkout set docker/freeswitch_configs
> # then mount docker/freeswitch_configs into the container at /etc/freeswitch
> ```

## Why this exists

The stock image's only usable TTS is `mod_flite` (low quality, no real prosody
or rate control). `mod_tts_commandline` is **already loaded** in
`../freeswitch_configs/autoload_configs/modules.conf.xml`, so we don't rebuild
FreeSWITCH — we just install Piper and point `mod_tts_commandline` at it.

## What's in here

| File | Purpose |
|------|---------|
| `Dockerfile` | `FROM safarov/freeswitch:latest` + Piper binary + one voice model. Includes a build‑time smoke test that fails the build if Piper can't synthesize. |
| `run.sh` | Builds the image (and, with `--up`, recreates the compose service and verifies Piper). |
| `add-voice.sh` | Downloads ANY Piper voice from the [catalog](https://rhasspy.github.io/piper-samples/voices.json) and live-installs it into the running container (no rebuild). Caches models under `voices/`. |
| `config/tts_commandline.conf.xml` | Piper override for `mod_tts_commandline`, used **only** by the test container. The original under `../freeswitch_configs/` is never touched. |
| `docker-compose.test.yml` | Standalone, isolated test container (`freeswitch-piper-test`) using `enjoys-freeswitch:latest` with the override layered on read‑only originals. |

## What you can do

### 1. Build the image
```bash
cd docker/freeswitch-custom
./run.sh                 # build only
./run.sh --up            # build + recreate the compose service
```

### 2. Pick the CPU architecture (only if not x86_64)
```bash
PIPER_ARCH=aarch64 ./run.sh     # Apple Silicon / ARM VPS
PIPER_ARCH=armv7l  ./run.sh     # 32-bit ARM
```

### 3. Choose a different voice
Browse voices at <https://huggingface.co/rhasspy/piper-voices>. Pass the voice
name and its HF path:
```bash
PIPER_VOICE=en_US-ryan-high \
PIPER_VOICE_PATH=en/en_US/ryan/high \
./run.sh
```
The voice file lands in the image at `/opt/piper/voices/<PIPER_VOICE>.onnx`.

### 4. Add extra voices (any language) with `add-voice.sh`
Piper ships hundreds of voices. Instead of rebuilding, fetch one and drop it
straight into the running container. The key format is
`<language>-<voice>-<quality>` (quality defaults to `medium`).

**Run it** (from `docker/freeswitch-custom`):
```bash
cd docker/freeswitch-custom
chmod +x add-voice.sh        # first time only (already executable in git)
./add-voice.sh --list en_US                 # browse English (US) voices
./add-voice.sh -l en_US -v ryan             # download + live-install en_US-ryan-medium
./add-voice.sh -l hi_IN -v pratham          # Hindi
./add-voice.sh es_ES davefx medium          # positional shorthand
```
> On Windows, run it from **git-bash** (`bash add-voice.sh -l en_US -v ryan`).
> It needs `curl` and `docker` on `PATH`; `python3`/`python` is optional (only
> used for `--list`, catalog validation and multi-speaker id lookup).

**Options:**

| Flag | Meaning | Default |
|------|---------|---------|
| `-l, --language CODE` | Language code, e.g. `en_US`, `hi_IN`, `fr_FR` **(required)** | — |
| `-v, --voice NAME` | Voice/model name, e.g. `amy`, `ryan` **(required)** | — |
| `-q, --quality Q` | `x_low` \| `low` \| `medium` \| `high` | `medium` |
| `-s, --speaker NAME` | Speaker for multi-speaker models | `default` |
| `-c, --container NAME` | Running FS container to live-install into (`-c ''` = download only) | `freeswitch-piper-test` |
| `-d, --dir DIR` | Local download/cache dir | `./voices` |
| `--list CODE` | List catalog voices for a language and exit | — |
| `--force` | Re-download even if files already exist | — |
| `-h, --help` | Show help and exit | — |

It downloads `<key>.onnx` + `<key>.onnx.json` into `voices/`, `docker cp`s them
into `freeswitch-piper-test:/opt/piper/voices/`, and smoke-tests Piper. Then
select it via the env-driven TTS in the repo `.env`:
```bash
TTS_ENGINE=tts_commandline
TTS_VOICE=en_US-ryan-medium
```
For multi-speaker models pass `-s <speaker>`; the script resolves the speaker id
and tells you how to pin it. `docker cp` is live but **ephemeral** (lost when the
container is recreated). To make it permanent, either bake it into the image —
```bash
PIPER_VOICE=en_US-ryan-medium PIPER_VOICE_PATH=en/en_US/ryan/medium ./run.sh
```
— or bind-mount `voices/` into the container at `/opt/piper/voices`.

### 5. Override the image tag / compose target
```bash
IMAGE_TAG=my-fs:dev COMPOSE_FILE=../docker-compose.prod.yml SERVICE=drachtio-freeswitch ./run.sh --up
```

## Wiring it in (one-time)

After the first build, point the FreeSWITCH service at this image. In
`../docker-compose.dev.yml` replace:
```yaml
    image: safarov/freeswitch:latest
```
with:
```yaml
    image: enjoys-freeswitch:latest
```
then `./run.sh --up`.

The remaining config lives outside this folder (bind-mounted, no rebuild needed):

1. **Point `mod_tts_commandline` at Piper** —
   `../freeswitch_configs/autoload_configs/tts_commandline.conf.xml`:
   ```xml
   <param name="command"
          value="echo ${text} | /opt/piper/piper --model /opt/piper/voices/${voice}.onnx --espeak_data /opt/piper/espeak-ng-data --output_file ${file}"/>
   ```
2. **Make Piper the default engine** —
   `../freeswitch_configs/vars.xml`: `tts_engine=tts_commandline`,
   `tts_voice=en_US-amy-medium`.
3. **App gotcha** — `src/sip/ivr.system.ts` `prepareVoice()` re-sets the engine
   to `flite` on every call; change it to `tts_commandline` /
   `en_US-amy-medium` or vars.xml is overridden.

## Test container (isolated, non-destructive)

Before wiring anything live, validate Piper inside a **real but throwaway**
FreeSWITCH process. It uses the custom image, mounts the original configs
**read‑only**, and layers `config/tts_commandline.conf.xml` on top — so no
original file and no running service is touched.

```bash
cd docker/freeswitch-custom
./run.sh                                            # build enjoys-freeswitch:latest first
docker compose -f docker-compose.test.yml up -d     # start the test FS
docker compose -f docker-compose.test.yml logs -f   # watch it boot (Ctrl-C to stop tailing)
```

Verify:
```bash
# 1) config parses cleanly (expect +OK, no XML error)
docker exec freeswitch-piper-test fs_cli -p 'JambonzR0ck$' -x reloadxml

# 2) module loaded?
docker exec freeswitch-piper-test fs_cli -p 'JambonzR0ck$' -x 'module_exists mod_tts_commandline'

# 3) Piper produces audio via the EXACT command mod_tts_commandline runs
docker exec freeswitch-piper-test sh -c "echo 'hello from piper' | /opt/piper/piper --model /opt/piper/voices/en_US-amy-medium.onnx --espeak_data /opt/piper/espeak-ng-data --output_file /tmp/t.wav && ls -l /tmp/t.wav"
```

Tear down when done:
```bash
docker compose -f docker-compose.test.yml down
```

> The test container publishes only ESL on `127.0.0.1:8022` (live FS uses 8021)
> and no SIP/RTP ports, so it cannot collide with `drachtio-freeswitch`.

## Verify (against the live service, after wiring)

```bash
# module loaded?
docker exec drachtio-freeswitch fs_cli -p 'JambonzR0ck$' -x 'module_exists mod_tts_commandline'
# Piper present?
docker exec drachtio-freeswitch /opt/piper/piper --help | head -n1
# synth a test file inside the container
docker exec drachtio-freeswitch sh -c "echo 'hello from piper' | /opt/piper/piper --model /opt/piper/voices/en_US-amy-medium.onnx --espeak_data /opt/piper/espeak-ng-data --output_file /tmp/t.wav && ls -l /tmp/t.wav"
```

## Notes

- **Latency:** first synth of a phrase is ~100–400 ms; cache WAVs per phrase if
  you need it instant.
- **Sample rate:** Piper medium voices output 22 050 Hz mono WAV with a proper
  header; FreeSWITCH resamples to the call rate automatically.
- **Pinned version:** downloads use Piper `2023.11.14-2`. If that release tag
  404s, bump `PIPER_VERSION` (build-arg in the `Dockerfile`).
