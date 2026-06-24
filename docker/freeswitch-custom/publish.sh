#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Build and publish the custom FreeSWITCH + Piper TTS image to Docker Hub.
#
# It reuses run.sh to build the image (same Piper build-args), tags it with a
# versioned tag AND :latest, then pushes both. Optionally syncs the README to
# the Docker Hub repo page if `docker-pushrm` is installed.
#
# Usage:
#   ./publish.sh                 # build + push  mullayam06/freeswitch-piper
#   ./publish.sh --no-latest     # push only the versioned tag (skip :latest)
#   ./publish.sh --no-build      # skip the build, just tag + push existing image
#
# Override defaults via env, e.g.:
#   VERSION=1.11-piper-ryan ./publish.sh
#   DOCKER_NAMESPACE=mycompany IMAGE_NAME=fs-piper ./publish.sh
#   PIPER_ARCH=aarch64 ./publish.sh            # ARM hosts
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

DOCKER_NAMESPACE="${DOCKER_NAMESPACE:-mullayam06}"
IMAGE_NAME="${IMAGE_NAME:-freeswitch-piper}"
VERSION="${VERSION:-1.10-piper-amy}"

REPO="${DOCKER_NAMESPACE}/${IMAGE_NAME}"
VERSIONED_TAG="${REPO}:${VERSION}"
LATEST_TAG="${REPO}:latest"

PUSH_LATEST=1
DO_BUILD=1
for arg in "$@"; do
  case "$arg" in
    --no-latest) PUSH_LATEST=0 ;;
    --no-build)  DO_BUILD=0 ;;
    -h|--help)
      sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done

cd "$(dirname "$0")"

# 1) Make sure we're logged in (push fails otherwise).
if ! docker info 2>/dev/null | grep -q "Username:"; then
  echo "▶ Not logged in to Docker Hub — running 'docker login'"
  docker login
fi

# 2) Build the image with the versioned tag (run.sh handles the Piper args).
if [[ "${DO_BUILD}" == "1" ]]; then
  echo "▶ Building ${VERSIONED_TAG}"
  IMAGE_TAG="${VERSIONED_TAG}" ./run.sh
else
  echo "▶ Skipping build (--no-build); expecting ${VERSIONED_TAG} to exist locally"
  docker image inspect "${VERSIONED_TAG}" >/dev/null
fi

# 3) Tag :latest off the versioned image.
if [[ "${PUSH_LATEST}" == "1" ]]; then
  echo "▶ Tagging ${LATEST_TAG}"
  docker tag "${VERSIONED_TAG}" "${LATEST_TAG}"
fi

# 4) Push.
echo "▶ Pushing ${VERSIONED_TAG}"
docker push "${VERSIONED_TAG}"
if [[ "${PUSH_LATEST}" == "1" ]]; then
  echo "▶ Pushing ${LATEST_TAG}"
  docker push "${LATEST_TAG}"
fi

# 5) Optional: sync README.md to the Docker Hub repo page.
if [[ -f README.md ]] && command -v docker-pushrm >/dev/null 2>&1; then
  echo "▶ Updating Docker Hub README via docker-pushrm"
  docker pushrm "${REPO}" -f README.md || echo "⚠️  README push failed (non-fatal)"
fi

echo
echo "✅ Published:"
echo "     ${VERSIONED_TAG}"
[[ "${PUSH_LATEST}" == "1" ]] && echo "     ${LATEST_TAG}"
echo "   https://hub.docker.com/r/${REPO}"
