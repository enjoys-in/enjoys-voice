#!/bin/sh
set -e

# ════════════════════════════════════════════════════════════════
#  Generate the RUNTIME config served at /runtime-config.js from env
#  vars, then start Next.js. Runs at container START so the same image
#  works in any environment without rebuilding.
#
#  Env vars consumed:
#    PUBLIC_API_BASE     e.g. http://localhost:3001 (Node) or https://voice.enjoys.in
#    PUBLIC_GO_API_BASE  optional; defaults to PUBLIC_API_BASE
#    PUBLIC_WS_URL       signaling WebSocket, e.g. ws://localhost:3002 / wss://DOMAIN/signal
#    PUBLIC_ICE_SERVERS  JSON array, e.g. [{"urls":"stun:stun.l.google.com:19302"}]
# ════════════════════════════════════════════════════════════════

CONFIG_PATH="/app/public/runtime-config.js"

cat > "$CONFIG_PATH" <<EOF
window.__RUNTIME_CONFIG__ = {
  "API_BASE": "${PUBLIC_API_BASE:-}",
  "GO_API_BASE": "${PUBLIC_GO_API_BASE:-${PUBLIC_API_BASE:-}}",
  "SIGNAL_URL": "${PUBLIC_WS_URL:-}",
  "ICE_SERVERS": ${PUBLIC_ICE_SERVERS:-[]}
};
EOF

echo "Generated $CONFIG_PATH:"
cat "$CONFIG_PATH"

exec bun run start
