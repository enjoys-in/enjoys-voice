#!/bin/sh
set -e

# ════════════════════════════════════════════════════════════════
#  Generate the RUNTIME config served at /runtime-config.js from env
#  vars, then start Next.js. This runs at container START, so the same
#  image can be deployed to any environment without rebuilding.
#
#  Env vars consumed:
#    PUBLIC_API_BASE     e.g. https://voice.enjoys.in
#    PUBLIC_GO_API_BASE  optional; defaults to PUBLIC_API_BASE (path-routed via
#                        Caddy: /api/g/* -> Go, /api/n/* -> Node on one domain)
#    PUBLIC_WS_URL       signaling WebSocket, e.g. wss://voice.enjoys.in/signal
#                        (Caddy upgrades /signal -> api:3002). MUST be set in
#                        prod, else the browser falls back to wss://host:3002,
#                        which is internal-only and never reachable.
#    PUBLIC_ICE_SERVERS  JSON array, e.g. [{"urls":"stun:..."}]
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
