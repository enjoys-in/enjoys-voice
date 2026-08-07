#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Build the standalone FreeSWITCH + mod_audio_stream image (from source).
#
# This is a SLOW build (it compiles FreeSWITCH and its SignalWire deps from
# source) — expect many minutes on first run; Docker layer cache makes rebuilds
# of just the module fast.
#
# Usage:
#   ./run.sh            # build the image
#   ./run.sh --up       # build, then run a throwaway container + verify the module
#
# Override via env:
#   FS_VERSION=v1.10.11 ./run.sh
#   MOD_AUDIO_STREAM_REF=v1.0.0 ./run.sh
#   PIPER_ARCH=aarch64 ./run.sh                                  # ARM hosts
#   PIPER_VOICE=en_US-ryan-high PIPER_VOICE_PATH=en/en_US/ryan/high ./run.sh
#   PIPER_EXTRA_VOICES="hi_IN-rohan-medium hi_IN-priyamvada-medium" ./run.sh
# ──────────────────────────────────────────────────────────────────────────────────
set -euo pipefail

IMAGE_TAG="${IMAGE_TAG:-enjoys-freeswitch-audiostream:latest}"
FS_VERSION="${FS_VERSION:-v1.10.12}"
MOD_AUDIO_STREAM_REF="${MOD_AUDIO_STREAM_REF:-master}"
PIPER_ARCH="${PIPER_ARCH:-x86_64}"
PIPER_VOICE="${PIPER_VOICE:-en_US-amy-medium}"
PIPER_VOICE_PATH="${PIPER_VOICE_PATH:-en/en_US/amy/medium}"
# Extra voices baked alongside the default (Hindi rohan + priyamvada by default).
PIPER_EXTRA_VOICES="${PIPER_EXTRA_VOICES:-hi_IN-rohan-medium hi_IN-priyamvada-medium}"

cd "$(dirname "$0")"

echo "▶ Building ${IMAGE_TAG}  (FreeSWITCH ${FS_VERSION}, mod_audio_stream ${MOD_AUDIO_STREAM_REF}, Piper ${PIPER_VOICE})"
echo "  (from-source build — this takes a while on first run)"
docker build \
  --build-arg FS_VERSION="${FS_VERSION}" \
  --build-arg MOD_AUDIO_STREAM_REF="${MOD_AUDIO_STREAM_REF}" \
  --build-arg PIPER_ARCH="${PIPER_ARCH}" \
  --build-arg PIPER_VOICE="${PIPER_VOICE}" \
  --build-arg PIPER_VOICE_PATH="${PIPER_VOICE_PATH}" \
  --build-arg PIPER_EXTRA_VOICES="${PIPER_EXTRA_VOICES}" \
  -t "${IMAGE_TAG}" \
  -f Dockerfile .

echo "✅ Built ${IMAGE_TAG}"

if [[ "${1:-}" == "--up" ]]; then
  CTR="fs-audiostream-check"
  echo "▶ Starting ${CTR} and verifying mod_audio_stream"
  docker rm -f "${CTR}" >/dev/null 2>&1 || true
  docker run -d --name "${CTR}" "${IMAGE_TAG}" >/dev/null
  # Give FreeSWITCH a moment to boot, then probe via fs_cli.
  for _ in $(seq 1 15); do
    if docker exec "${CTR}" fs_cli -x 'status' >/dev/null 2>&1; then break; fi
    sleep 1
  done
  if docker exec "${CTR}" fs_cli -x 'module_exists mod_audio_stream' | grep -qi true; then
    echo "✅ mod_audio_stream is loaded"
    docker exec "${CTR}" fs_cli -x 'show api' | grep -i uuid_audio_stream || true
  else
    echo "⚠️  mod_audio_stream did NOT load — check: docker logs ${CTR}"
  fi
  if docker exec "${CTR}" fs_cli -x 'module_exists mod_tts_commandline' | grep -qi true; then
    echo "✅ mod_tts_commandline (Piper TTS) is loaded"
  else
    echo "⚠️  mod_tts_commandline did NOT load — check: docker logs ${CTR}"
  fi
  echo "ℹ️  Tear down with:  docker rm -f ${CTR}"
fi
