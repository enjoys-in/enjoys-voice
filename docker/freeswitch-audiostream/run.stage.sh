#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# Build the MULTI-STAGE FreeSWITCH + mod_audio_stream image.
#
# Same functionality as run.sh but uses Dockerfile.stage (two-stage build)
# for a dramatically smaller final image (~300-400 MB vs ~1+ GB).
#
# Usage:
#   ./run.stage.sh            # build the image
#   ./run.stage.sh --up       # build, then run a throwaway container + verify
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# Fix for Git Bash on Windows wrongly converting /udp and /tcp to C:/Program Files/Git/udp
export MSYS_NO_PATHCONV=1

IMAGE_TAG="${IMAGE_TAG:-enjoys-freeswitch-audiostream-stage:latest}"
FS_VERSION="${FS_VERSION:-v1.10.12}"
MOD_AUDIO_STREAM_REF="${MOD_AUDIO_STREAM_REF:-master}"
PIPER_ARCH="${PIPER_ARCH:-x86_64}"
PIPER_VOICE="${PIPER_VOICE:-en_US-amy-medium}"
PIPER_VOICE_PATH="${PIPER_VOICE_PATH:-en/en_US/amy/medium}"
PIPER_EXTRA_VOICES="${PIPER_EXTRA_VOICES:-hi_IN-rohan-medium hi_IN-priyamvada-medium}"

cd "$(dirname "$0")"

echo "▶ Building ${IMAGE_TAG}  (FreeSWITCH ${FS_VERSION}, mod_audio_stream ${MOD_AUDIO_STREAM_REF}, Piper ${PIPER_VOICE})"
echo "  (MULTI-STAGE build — final image will be slim)"
docker build \
  --build-arg FS_VERSION="${FS_VERSION}" \
  --build-arg MOD_AUDIO_STREAM_REF="${MOD_AUDIO_STREAM_REF}" \
  --build-arg PIPER_ARCH="${PIPER_ARCH}" \
  --build-arg PIPER_VOICE="${PIPER_VOICE}" \
  --build-arg PIPER_VOICE_PATH="${PIPER_VOICE_PATH}" \
  --build-arg PIPER_EXTRA_VOICES="${PIPER_EXTRA_VOICES}" \
  -t "${IMAGE_TAG}" \
  -f Dockerfile.stage .

echo "✅ Built ${IMAGE_TAG}"

# Show image size comparison.
echo ""
echo "📦 Image sizes:"
docker images --format "  {{.Repository}}:{{.Tag}}\t{{.Size}}" | grep -i "enjoys-freeswitch-audiostream" || true
echo ""

if [[ "${1:-}" == "--up" ]]; then
  CTR="fs-audiostream-stage-check"
  echo "▶ Starting ${CTR} and verifying mod_audio_stream"
  docker rm -f "${CTR}" >/dev/null 2>&1 || true
  docker run -d --name "${CTR}" \
    -p 8021:8021 \
    -p 5060:5060/udp -p 5060:5060/tcp \
    -p 5080:5080/udp -p 5080:5080/tcp \
    -p 5066:5066 -p 7443:7443 \
    -p 16384-16404:16384-16404/udp \
    "${IMAGE_TAG}" >/dev/null
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
