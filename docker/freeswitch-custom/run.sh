#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Build the custom FreeSWITCH + Piper TTS image, and optionally recreate the
# compose service. Self-contained: the Dockerfile COPYs nothing, so the build
# context is just this folder.
#
# Usage:
#   ./run.sh                 # build the image only
#   ./run.sh --up            # build, then recreate the compose service
#
# Override defaults via env, e.g.:
#   PIPER_ARCH=aarch64 ./run.sh           # ARM hosts (Apple Silicon / ARM VPS)
#   PIPER_VOICE=en_US-ryan-high PIPER_VOICE_PATH=en/en_US/ryan/high ./run.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

IMAGE_TAG="${IMAGE_TAG:-callnet-freeswitch-piper:latest}"
PIPER_ARCH="${PIPER_ARCH:-x86_64}"                 # x86_64 | aarch64 | armv7l
PIPER_VOICE="${PIPER_VOICE:-en_US-amy-medium}"
PIPER_VOICE_PATH="${PIPER_VOICE_PATH:-en/en_US/amy/medium}"
COMPOSE_FILE="${COMPOSE_FILE:-../docker-compose.dev.yml}"
SERVICE="${SERVICE:-drachtio-freeswitch}"

cd "$(dirname "$0")"

echo "▶ Building ${IMAGE_TAG}  (arch=${PIPER_ARCH}, voice=${PIPER_VOICE})"
docker build \
  --build-arg PIPER_ARCH="${PIPER_ARCH}" \
  --build-arg PIPER_VOICE="${PIPER_VOICE}" \
  --build-arg PIPER_VOICE_PATH="${PIPER_VOICE_PATH}" \
  -t "${IMAGE_TAG}" \
  -f Dockerfile .

echo "✅ Built ${IMAGE_TAG}"

if [[ "${1:-}" == "--up" ]]; then
  echo "▶ Recreating service '${SERVICE}' from ${COMPOSE_FILE}"
  docker compose -f "${COMPOSE_FILE}" up -d "${SERVICE}"
  echo "▶ Verifying Piper inside the container"
  docker exec "${SERVICE}" /opt/piper/piper --help >/dev/null 2>&1 \
    && echo "✅ Piper binary present in ${SERVICE}" \
    || echo "⚠️  Could not run Piper in ${SERVICE} (is the service using image: ${IMAGE_TAG}?)"
else
  cat <<EOF

Next steps:
  1) Point the FreeSWITCH service at this image. In ${COMPOSE_FILE}, replace
       image: safarov/freeswitch:latest
     with
       image: ${IMAGE_TAG}
  2) Recreate it:
       docker compose -f ${COMPOSE_FILE} up -d ${SERVICE}
     (or re-run:  ./run.sh --up)
EOF
fi
