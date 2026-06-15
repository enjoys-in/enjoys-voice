#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
#  Generate a self-signed TLS cert for drachtio's secure WebSocket (wss) port.
#
#  WHY self-signed is fine: the ONLY client of this cert is Caddy, connecting
#  over the internal docker network with `tls_insecure_skip_verify`. Browsers
#  never touch it — they hit Caddy's real Let's Encrypt cert at https://DOMAIN.
#  Caddy terminates that public TLS and re-encrypts to drachtio here, so the
#  transport drachtio receives is genuinely `wss` and matches SIP.js's
#  `Via: SIP/2.0/WSS` (a plain-ws listener would 400 that Via).
#
#  USAGE (run once on the VPS, before `docker compose up`):
#      ./prod/drachtio/gen-cert.sh
#
#  Output: prod/drachtio/tls/{key.pem,cert.pem}  (git-ignored, mounted read-only
#  into the drachtio container at /etc/drachtio/tls).
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/tls"
mkdir -p "$DIR"

if [[ -f "$DIR/cert.pem" && -f "$DIR/key.pem" ]]; then
  echo "✅ cert already present in $DIR — delete key.pem/cert.pem to regenerate."
  exit 0
fi

openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout "$DIR/key.pem" \
  -out "$DIR/cert.pem" \
  -days 3650 \
  -subj "/CN=drachtio-server" \
  -addext "subjectAltName=DNS:drachtio-server,DNS:localhost"

chmod 600 "$DIR/key.pem"
echo "✅ Generated self-signed drachtio WSS cert in $DIR (valid 10 years)."
