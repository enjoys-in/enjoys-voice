#!/usr/bin/env bash
# Build the CallNet edge FreeSWITCH .deb for one or more architectures via
# docker buildx (+ qemu for cross-arch). Output -> ./out/<platform>/*.deb
#
#   PLATFORMS=linux/amd64           ./build-deb.sh   # just this host's arch (fast)
#   PLATFORMS=linux/amd64,linux/arm64 ./build-deb.sh # both (arm64 via qemu, slow)
set -euo pipefail
cd "$(dirname "$0")"

PLATFORMS="${PLATFORMS:-linux/amd64,linux/arm64}"
FS_VERSION="${FS_VERSION:-v1.10.12}"

# qemu for cross-arch emulation (no-op if already registered).
if [[ "$PLATFORMS" == *arm64* ]] && command -v docker >/dev/null; then
  docker run --rm --privileged tonistiigi/binfmt --install arm64 >/dev/null 2>&1 || true
fi

docker buildx inspect callnet-fs >/dev/null 2>&1 || docker buildx create --name callnet-fs >/dev/null
docker buildx use callnet-fs

mkdir -p out
docker buildx build \
  --platform "$PLATFORMS" \
  --build-arg FS_VERSION="$FS_VERSION" \
  --target export \
  --output type=local,dest=out \
  .

echo "── artifacts ─────────────────────────────"
find out -name '*.deb' -print
