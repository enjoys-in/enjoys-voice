#!/usr/bin/env bash
# Cross-compile the CallNet edge agent to static Linux binaries (amd64 + arm64).
# Output: edge/dist/callnet-edge-agent-linux-{amd64,arm64}
set -euo pipefail
cd "$(dirname "$0")/agent"
OUT="../dist"
mkdir -p "$OUT"
echo "Building CallNet edge agent (static, multi-arch)…"
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags "-s -w" -o "$OUT/callnet-edge-agent-linux-amd64" .
CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -trimpath -ldflags "-s -w" -o "$OUT/callnet-edge-agent-linux-arm64" .
ls -lh "$OUT"
