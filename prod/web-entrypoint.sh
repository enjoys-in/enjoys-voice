#!/bin/sh
set -e

# ════════════════════════════════════════════════════════════════
#  Generate the RUNTIME config served at /runtime-config.js from env
#  vars, then start Next.js. This runs at container START, so the same
#  image can be deployed to any environment without rebuilding.
#
#  Env vars consumed:
#    PUBLIC_API_BASE     e.g. https://voice.enjoys.in
#    PUBLIC_ICE_SERVERS  JSON array, e.g. [{"urls":"stun:..."}]
# ════════════════════════════════════════════════════════════════

CONFIG_PATH="/app/public/runtime-config.js"

cat > "$CONFIG_PATH" <<EOF
window.__RUNTIME_CONFIG__ = {
  "API_BASE": "${PUBLIC_API_BASE:-}",
  "ICE_SERVERS": ${PUBLIC_ICE_SERVERS:-[]}
};
EOF

echo "Generated $CONFIG_PATH:"
cat "$CONFIG_PATH"

exec bun run start
