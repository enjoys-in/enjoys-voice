#!/usr/bin/env bash
# CallNet Edge — native installer (no Docker). Debian / Ubuntu / Raspberry Pi OS.
# Installs coturn + the agent + systemd unit, deploys the FreeSWITCH overlays,
# and (re)starts services. FreeSWITCH itself must already be installed (see README).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="${ENV_FILE:-/etc/callnet-edge/agent.env}"

[ "$(id -u)" -eq 0 ] || { echo "run as root (sudo)"; exit 1; }

# ── pick the agent binary for this CPU ────────────────────────────────────
case "$(uname -m)" in
  x86_64|amd64)  ARCH=amd64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  *) echo "unsupported arch: $(uname -m)"; exit 1 ;;
esac
BIN="$HERE/dist/callnet-edge-agent-linux-$ARCH"
[ -x "$BIN" ] || { echo "missing $BIN — run ./build.sh first"; exit 1; }

# ── coturn (in the Debian/Ubuntu repos) ──────────────────────────────────
apt-get update -y
apt-get install -y coturn

# ── FreeSWITCH: install the bundled .deb for this arch if present ──────────
# Drop edge/packages/callnet-freeswitch_<ver>_<arch>.deb in (built by
# edge/packaging/freeswitch). This removes the manual FreeSWITCH install step.
if ! command -v freeswitch >/dev/null 2>&1; then
  DEB="$(ls "$HERE/packages/callnet-freeswitch_"*"_${ARCH}.deb" 2>/dev/null | head -n1 || true)"
  if [ -n "$DEB" ]; then
    echo "Installing bundled FreeSWITCH: $DEB"
    apt-get install -y "$DEB"
  fi
fi
if ! command -v freeswitch >/dev/null 2>&1; then
  echo "!! FreeSWITCH not found and no bundled .deb in $HERE/packages/."
  echo "!! Build one: edge/packaging/freeswitch/build-deb.sh (see its README),"
  echo "!! or install via the SignalWire repo, then re-run this script."
fi

# ── environment file ──────────────────────────────────────────────────────
mkdir -p "$(dirname "$ENV_FILE")"
if [ ! -f "$ENV_FILE" ]; then
  cp "$HERE/agent.env.example" "$ENV_FILE"
  echo "Wrote $ENV_FILE from template — EDIT IT (device id/token, TURN ip/pw)."
fi
set -a; . "$ENV_FILE"; set +a

# ── FreeSWITCH config overlays ────────────────────────────────────────────
if [ -d /etc/freeswitch ]; then
  install -m 0644 "$HERE/freeswitch/config/autoload_configs/event_socket.conf.xml" /etc/freeswitch/autoload_configs/
  install -d /etc/freeswitch/sip_profiles/external /etc/freeswitch/dialplan/default /etc/freeswitch/dialplan/public /etc/freeswitch/directory/default
  install -m 0644 "$HERE/freeswitch/config/sip_profiles/external/callnet_trunk.xml" /etc/freeswitch/sip_profiles/external/
  install -m 0644 "$HERE/freeswitch/config/dialplan/default/00_callnet_edge.xml"    /etc/freeswitch/dialplan/default/
  install -m 0644 "$HERE/freeswitch/config/dialplan/public/00_callnet_inbound.xml"  /etc/freeswitch/dialplan/public/
  install -m 0644 "$HERE/freeswitch/config/directory/default/1001.xml"              /etc/freeswitch/directory/default/
fi

# ── coturn config from the template ───────────────────────────────────────
sed -e "s|REPLACE_TURN_EXTERNAL_IP|${TURN_EXTERNAL_IP:-}|g" \
    -e "s|REPLACE_TURN_USER|${TURN_USER:-callnet}|g" \
    -e "s|REPLACE_TURN_PASSWORD|${TURN_PASSWORD:-changeme}|g" \
    -e "s|REPLACE_TURN_REALM|${TURN_REALM:-callnet.local}|g" \
    "$HERE/coturn/turnserver.conf" > /etc/turnserver.conf
echo 'TURNSERVER_ENABLED=1' > /etc/default/coturn

# ── agent binary + service ────────────────────────────────────────────────
install -m 0755 "$BIN" /usr/local/bin/callnet-edge-agent
install -m 0644 "$HERE/systemd/callnet-edge-agent.service" /etc/systemd/system/callnet-edge-agent.service

systemctl daemon-reload
systemctl enable --now coturn || true
command -v freeswitch >/dev/null 2>&1 && systemctl enable --now freeswitch || true
systemctl enable callnet-edge-agent
systemctl restart callnet-edge-agent

echo "Done. Tail the agent:  journalctl -u callnet-edge-agent -f"
