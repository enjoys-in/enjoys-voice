# ─────────────────────────────────────────────────────────────────────────────
# Custom FreeSWITCH image = stock safarov/freeswitch + Piper neural TTS.
#
# WHY: the stock image's only working TTS is mod_flite (robotic, low quality).
# mod_tts_commandline is ALREADY loaded in modules.conf.xml, so we don't rebuild
# FreeSWITCH — we just add Piper (self-hosted neural TTS, no cloud/keys) and
# point mod_tts_commandline at it (see autoload_configs/tts_commandline.conf.xml).
#
# The base is a minimal busybox/buildroot rootfs: glibc (so Piper's prebuilt
# glibc binary runs, and libstdc++/libgomp are present) but NO package manager
# and NO CA certificates, so we can't download inside it. Hence a MULTI-STAGE
# build: a full Debian stage fetches Piper + a voice model, and the final stage
# just copies them onto the stock FreeSWITCH image.
#
# Build with run.sh (handles arch/voice build-args).
# ─────────────────────────────────────────────────────────────────────────────

# ── Stage 1: fetch Piper (binary + libs + espeak-ng-data) and a voice model ──
FROM debian:bookworm-slim AS fetch

ARG PIPER_VERSION=2023.11.14-2
ARG PIPER_ARCH=x86_64
ARG PIPER_VOICE=en_US-amy-medium
ARG PIPER_VOICE_PATH=en/en_US/amy/medium

RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates \
 && mkdir -p /opt/piper/voices \
 && curl -fL "https://github.com/rhasspy/piper/releases/download/${PIPER_VERSION}/piper_linux_${PIPER_ARCH}.tar.gz" \
      | tar -xzC /opt/piper --strip-components=1 \
 && curl -fL -o "/opt/piper/voices/${PIPER_VOICE}.onnx" \
      "https://huggingface.co/rhasspy/piper-voices/resolve/main/${PIPER_VOICE_PATH}/${PIPER_VOICE}.onnx" \
 && curl -fL -o "/opt/piper/voices/${PIPER_VOICE}.onnx.json" \
      "https://huggingface.co/rhasspy/piper-voices/resolve/main/${PIPER_VOICE_PATH}/${PIPER_VOICE}.onnx.json" \
 && test -s "/opt/piper/voices/${PIPER_VOICE}.onnx" \
 && test -x /opt/piper/piper

# ── Stage 2: final image = stock FreeSWITCH + Piper ──
FROM safarov/freeswitch:latest

# Re-declare so the smoke test below knows which model file to use.
ARG PIPER_VOICE=en_US-amy-medium

COPY --from=fetch /opt/piper /opt/piper

# The minimal buildroot base ships WITHOUT /tmp. FreeSWITCH's default temp_dir
# (where mod_tts_commandline writes the synthesized WAV) is /tmp, and Piper also
# needs a writable dir, so create it. Without this, piper exits 0 but silently
# writes nothing and the TTS produces no audio.
RUN mkdir -p /tmp && chmod 1777 /tmp

# Build-time smoke test: fail early if the binary/libs/model don't synthesize.
RUN echo "freeswitch piper build check" \
      | /opt/piper/piper \
          --model "/opt/piper/voices/${PIPER_VOICE}.onnx" \
          --espeak_data /opt/piper/espeak-ng-data \
          --output_file /tmp/_piper_check.wav \
 && test -s /tmp/_piper_check.wav \
 && rm -f /tmp/_piper_check.wav \
 && echo "Piper OK"

# ── Wire Piper in as the DEFAULT TTS engine (works out of the box, no mounts) ──
# The stock image ships mod_tts_commandline DISABLED and pointed at festival's
# text2wave, so a freshly pulled image would NOT speak with Piper unless you
# mounted configs. Bake the wiring so it just works:
#   1) point mod_tts_commandline at the Piper binary (overwrite the festival cfg),
#   2) load the module (it's commented out in the stock modules.conf.xml),
#   3) set FreeSWITCH's default tts_engine + tts_voice to Piper + the baked voice.
#
# IMPORTANT: at build time there is NO /etc/freeswitch — the base image's
# /docker-entrypoint.sh copies /usr/share/freeswitch/conf/vanilla/* into
# /etc/freeswitch on FIRST start (only when /etc/freeswitch/freeswitch.xml is
# absent). So we patch the VANILLA source. A bare image then boots Piper-wired;
# bind-mount your own /etc/freeswitch (or a single file) and the entrypoint skips
# the copy / your mount shadows ours, so YOURS wins.
COPY config/tts_commandline.conf.xml /usr/share/freeswitch/conf/vanilla/autoload_configs/tts_commandline.conf.xml
RUN set -eux; \
    conf=/usr/share/freeswitch/conf/vanilla; \
    sed -i 's|<!-- *<load module="mod_tts_commandline"/> *-->|<load module="mod_tts_commandline"/>|' \
        "$conf/autoload_configs/modules.conf.xml"; \
    grep -q '<load module="mod_tts_commandline"/>' "$conf/autoload_configs/modules.conf.xml"; \
    sed -i "s|</include>|  <X-PRE-PROCESS cmd=\"set\" data=\"tts_engine=tts_commandline\"/>  <X-PRE-PROCESS cmd=\"set\" data=\"tts_voice=${PIPER_VOICE}\"/></include>|" \
        "$conf/vars.xml"; \
    grep -q "tts_voice=${PIPER_VOICE}" "$conf/vars.xml"; \
    echo "Piper wired as default TTS (engine=tts_commandline, voice=${PIPER_VOICE})"
