# ─────────────────────────────────────────────────────────────────────────────
# Custom FreeSWITCH image = stock safarov/freeswitch + Piper neural TTS.
#
# WHY: the stock image's only working TTS is mod_flite (robotic, low quality).
# mod_tts_commandline is ALREADY loaded in modules.conf.xml, so we don't rebuild
# FreeSWITCH — we just install Piper (self-hosted neural TTS, no cloud/keys) and
# point mod_tts_commandline at it (see autoload_configs/tts_commandline.conf.xml).
#
# Build with run.sh (handles arch/voice build-args).
# ─────────────────────────────────────────────────────────────────────────────
FROM safarov/freeswitch:latest

# Override at build time via run.sh / --build-arg.
ARG PIPER_VERSION=2023.11.14-2
ARG PIPER_ARCH=x86_64
ARG PIPER_VOICE=en_US-amy-medium
ARG PIPER_VOICE_PATH=en/en_US/amy/medium

# 1) Piper binary (+ bundled libs + espeak-ng-data) and one voice model.
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates \
 && mkdir -p /opt/piper/voices \
 && curl -fL "https://github.com/rhasspy/piper/releases/download/${PIPER_VERSION}/piper_linux_${PIPER_ARCH}.tar.gz" \
      | tar -xzC /opt/piper --strip-components=1 \
 && curl -fL -o "/opt/piper/voices/${PIPER_VOICE}.onnx" \
      "https://huggingface.co/rhasspy/piper-voices/resolve/main/${PIPER_VOICE_PATH}/${PIPER_VOICE}.onnx" \
 && curl -fL -o "/opt/piper/voices/${PIPER_VOICE}.onnx.json" \
      "https://huggingface.co/rhasspy/piper-voices/resolve/main/${PIPER_VOICE_PATH}/${PIPER_VOICE}.onnx.json" \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/*

# 2) Build-time smoke test: fail early if the binary/libs/model don't work.
RUN echo "freeswitch piper build check" \
      | /opt/piper/piper \
          --model "/opt/piper/voices/${PIPER_VOICE}.onnx" \
          --espeak_data /opt/piper/espeak-ng-data \
          --output_file /tmp/_piper_check.wav \
 && test -s /tmp/_piper_check.wav \
 && rm -f /tmp/_piper_check.wav \
 && echo "Piper OK"
