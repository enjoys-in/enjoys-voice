# CallNet - Production Server Setup

## Architecture Overview

```
Browser (WebRTC/SIP.js) ──WSS──▶ Drachtio ──SIP──▶ FreeSWITCH (Media)
                                     │
                                     ▼
                              CallNet API (Bun)
                              ├── HTTP  :3001
                              ├── WS    :3002
                              └── SIP logic + IVR
```

## Prerequisites

- Linux server (Ubuntu 22.04+ recommended) or Windows with Docker Desktop
- Docker & Docker Compose v2
- Bun runtime (v1.3+)
- Domain name with DNS A record pointing to server IP
- Open firewall ports (see below)

## Required Ports

| Port | Protocol | Service | Notes |
|------|----------|---------|-------|
| 80/443 | TCP | Next.js Frontend | Behind reverse proxy |
| 3001 | TCP | CallNet HTTP API | Can proxy via Nginx |
| 3002 | TCP | CallNet WebSocket | Signaling |
| 5060 | UDP+TCP | SIP | Drachtio SIP signaling |
| 5065 | TCP | SIP WebSocket | Browser SIP.js connections |
| 8021 | TCP | FreeSWITCH ESL | Internal only (Docker network) |
| 9022 | TCP | Drachtio Admin | Internal only (Docker network) |
| 16384-32768 | UDP | RTP Media | FreeSWITCH audio/video |

## Environment Variables

Create `.env` in the project root:

```bash
# ─── Server ───────────────────────────────────────────
PUBLIC_IP=YOUR_SERVER_PUBLIC_IP        # e.g. 203.0.113.10
DOMAIN=your-domain.com                # SIP domain
HTTP_PORT=3001
WS_PORT=3002

# ─── Drachtio ─────────────────────────────────────────
DRACHTIO_HOST=127.0.0.1               # localhost if on same host
DRACHTIO_PORT=9022
DRACHTIO_SECRET=CHANGE_ME_STRONG_SECRET

# ─── FreeSWITCH ───────────────────────────────────────
FREESWITCH_HOST=127.0.0.1             # localhost (port 8021 exposed)
FREESWITCH_PORT=8021
FREESWITCH_SECRET=JambonzR0ck$
FREESWITCH_LISTEN_ADDRESS=YOUR_SERVER_PUBLIC_IP   # CRITICAL: must be reachable by FS container
FREESWITCH_LISTEN_PORT=8085
# Windows dev: use host.docker.internal (Docker bridge gateway IP won't work)
# Linux prod: use the host's actual IP or 0.0.0.0

# ─── SIP Trunk (optional, for PSTN) ──────────────────
TRUNK_HOST=                           # Leave empty to disable
TRUNK_PORT=5060
TRUNK_TRANSPORT=udp
TRUNK_USERNAME=
TRUNK_PASSWORD=
TRUNK_CALLER_NUMBER=
TRUNK_PREFIX=

# ─── IVR ──────────────────────────────────────────────
IVR_ENABLED=true
IVR_ENTRY=5000
BIZ_HOURS_START=9
BIZ_HOURS_END=18
IVR_DEFAULT_LANG=en

# ─── SIP Users ────────────────────────────────────────
# Currently hardcoded in config.ts - move to DB for production
```

## Changes Required for Production

### 1. Docker Compose (`docker/docker-compose.yml`)

```diff
# Drachtio - set your actual external IP
  environment:
-   - DRACHTIO_EXTERNAL_IP=auto
+   - DRACHTIO_EXTERNAL_IP=YOUR_SERVER_PUBLIC_IP
-   - DRACHTIO_SECRET=siprocks
+   - DRACHTIO_SECRET=CHANGE_ME_STRONG_SECRET
```

### 2. Drachtio Config (`docker/drachtio-server/config/drachtio.conf.xml`)

```xml
<drachtio>
  <logging>
    <console/>
    <loglevel>info</loglevel>
    <sofia-loglevel>3</sofia-loglevel>
  </logging>

  <sip>
    <contacts>
      <contact>sip:*@0.0.0.0:5060;transport=udp,tcp</contact>
      <!-- Use WSS (TLS) in production -->
      <contact>sip:*@0.0.0.0:5065;transport=wss</contact>
    </contacts>
    <!-- Add external IP for NAT traversal -->
    <external-address>YOUR_SERVER_PUBLIC_IP</external-address>
  </sip>

  <admin port="9022" secret="CHANGE_ME_STRONG_SECRET">0.0.0.0</admin>
</drachtio>
```

### 3. FreeSWITCH MRF

**Important:** The `drachtio/drachtio-freeswitch-mrf` image stores its config at `/usr/local/freeswitch/conf/` (NOT `/etc/freeswitch`). The SIP profile used is `drachtio_mrf`.

**Do NOT mount a volume to override the config** unless you have a complete valid config. The default config works; only the sounds volume is needed:
```yaml
volumes:
  - ./drachtio/drachtio-freeswitch-mrf/sounds:/usr/share/freeswitch/sounds
```

For production, if you need to customize the SIP profile, exec into the container:
```bash
docker exec -it drachtio-freeswitch bash
cat /usr/local/freeswitch/conf/sip_profiles/drachtio_mrf.xml
```

Key params to update for NAT traversal:
```xml
<param name="ext-rtp-ip" value="YOUR_SERVER_PUBLIC_IP"/>
<param name="ext-sip-ip" value="YOUR_SERVER_PUBLIC_IP"/>
<param name="apply-candidate-acl" value="localnet.auto"/>
```

#### WebRTC → IVR media negotiation (REQUIRED for browser clients)

Browser (WebRTC) calls into the IVR go **through** FreeSWITCH (via
`connectCaller`), unlike direct extension-to-extension calls where the two
browsers negotiate media with each other. This exposes the `drachtio_mrf`
profile to the browser's WebRTC SDP, which needs three things or the call
fails. The working config (`docker/freeswitch_configs/sip_profiles/drachtio_mrf.xml`):

```xml
<!-- Accept the browser's DTLS-SRTP offer; plain RTP softphones still work -->
<param name="rtp-secure-media" value="optional"/>

<!-- Accept the browser's ICE candidates. WebRTC clients on a LAN/host send
     RFC1918 (192.168.x / 172.x / 10.x) candidates; the default wan.auto ACL
     (public IPs only) filters them all out => 488 Not Acceptable Here. -->
<param name="apply-candidate-acl" value="localnet.auto"/>
<param name="apply-candidate-acl" value="wan_v4.auto"/>
<param name="apply-candidate-acl" value="rfc1918.auto"/>
<param name="apply-candidate-acl" value="any_v4.auto"/>
```

And the default TTS engine for `say:` IVR prompts (`docker/freeswitch_configs/vars.xml`):

```xml
<!-- mod_flite is built in; without these the say: prompts produce no audio -->
<X-PRE-PROCESS cmd="set" data="tts_engine=flite"/>
<X-PRE-PROCESS cmd="set" data="tts_voice=slt"/>
```

After editing volume-mounted config, recreate the container so it loads fresh:
```bash
docker compose up -d --force-recreate drachtio-freeswitch
```


### 4. TLS/SSL Certificates

For production, SIP WebSocket MUST use WSS (TLS). Options:
- Use Nginx as TLS termination proxy for port 5065
- Or configure Drachtio with TLS certificates directly

### 5. Next.js Frontend (`web/`)

Update `web/.env.local`:
```bash
NEXT_PUBLIC_SIP_WS_URL=wss://your-domain.com:5065
NEXT_PUBLIC_API_URL=https://your-domain.com/api
NEXT_PUBLIC_WS_URL=wss://your-domain.com:3002
```

### 6. Nginx Reverse Proxy (recommended)

```nginx
server {
    listen 443 ssl;
    server_name your-domain.com;

    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    # Frontend
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    # API
    location /api/ {
        proxy_pass http://127.0.0.1:3001/;
    }

    # WebSocket signaling
    location /ws {
        proxy_pass http://127.0.0.1:3002;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

## Deployment Steps

```bash
# 1. Clone and install
git clone <repo> /opt/callnet
cd /opt/callnet

# 2. Install Bun
curl -fsSL https://bun.sh/install | bash

# 3. Install dependencies
bun install
cd web && bun install && cd ..

# 4. Configure environment
cp .env.example .env
# Edit .env with your server IP, domain, secrets

# 5. Start Docker services
cd docker
docker compose up -d drachtio-server drachtio-freeswitch
cd ..

# 6. Build and run
bun run build
bun run start &

# 7. Build and serve frontend
cd web
bun run build
bun run start &
```

## Security Checklist

- [ ] Change all default passwords (drachtio secret, FreeSWITCH ESL password)
- [ ] Use WSS (not WS) for SIP WebSocket in production
- [ ] Restrict port 8021 and 9022 to Docker internal network only
- [ ] Enable SIP authentication for all users
- [ ] Move SIP user credentials to a database (not hardcoded)
- [ ] Set up fail2ban or similar for SIP brute-force protection
- [ ] Use HTTPS/WSS for all browser-facing connections
- [ ] Configure firewall (UFW/iptables) to only allow required ports
- [ ] Set up log rotation for FreeSWITCH and application logs

## Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| IVR Connection timeout | `listenAddress` not reachable from FS container | On Windows: set `FREESWITCH_LISTEN_ADDRESS=host.docker.internal`. On Linux: use host IP. Do NOT use Docker bridge gateway IP (172.x.x.1) on Windows |
| IVR Connection timeout | `listenPort` is 0 or wrong | Ensure `FREESWITCH_LISTEN_PORT=8085` (must match the port your app listens on for MRF callbacks) |
| IVR Connection timeout | Volume mount overrides FS config | Do NOT mount to `/usr/local/freeswitch/conf/` or `/etc/freeswitch`. Only mount sounds |
| **IVR `488 Not Acceptable Here`** (WebRTC client) | FreeSWITCH `drachtio_mrf` profile rejected the browser's ICE candidates — default `wan.auto` ACL filters out RFC1918/LAN candidates → log shows `no suitable candidates found` → 488 | Add `apply-candidate-acl` (localnet.auto, wan_v4.auto, rfc1918.auto, any_v4.auto) to the `drachtio_mrf` profile, then recreate the container |
| **IVR `488 Not Acceptable Here`** (WebRTC client) | Profile had no secure-media support, so the browser's DTLS-SRTP offer was refused | Add `<param name="rtp-secure-media" value="optional"/>` to the `drachtio_mrf` profile |
| **IVR prompt silent / `say:` no audio** | No default TTS engine configured; `say:<text>` had nothing to synthesize with | Set `tts_engine=flite` + `tts_voice=slt` in `vars.xml` (mod_flite is built in) |
| **IVR call answers then drops after ~3s** | `ext-rtp-ip` advertises the container's internal Docker IP (e.g. 172.21.0.3), unreachable by the browser, so media/DTLS never completes and FS tears the call down | Set `ext-rtp-ip`/`ext-sip-ip` to the host LAN/public IP (or `auto-nat`) and ensure the RTP port range is published + firewall-open |
| WebRTC no audio | NAT traversal failure | Set correct ext-rtp-ip in FS profile, ensure STUN/TURN |
| SIP register fails | Wrong domain/WS URL | Match DOMAIN env with client config |
| "Lost connection to FreeSWITCH" | Container restarted/ESL unreachable | Check `docker logs drachtio-freeswitch`, verify port 8021 exposed |
| Tone keeps playing after hangup | Async sound fetch race condition | Fixed: uses monotonic `toneIdRef` counter to cancel stale audio |

## STUN/TURN (for NAT traversal)

For clients behind NAT, configure a TURN server:
```bash
# Install coturn
apt install coturn

# /etc/turnserver.conf
listening-port=3478
external-ip=YOUR_SERVER_PUBLIC_IP
realm=your-domain.com
user=turnuser:turnpassword
```

Then update the frontend SIP.js config to use the TURN server.

## Windows Development Notes

### Docker Networking

On Windows with Docker Desktop, containers cannot reach the host via the Docker bridge gateway IP (e.g. `172.21.0.1`). Use `host.docker.internal` instead:

```bash
# .env for Windows dev
FREESWITCH_LISTEN_ADDRESS=host.docker.internal
```

This is the address FreeSWITCH will use to connect back to your Bun app for MRF/IVR callbacks.

### FreeSWITCH MRF Connection

The IVR system connects to FreeSWITCH via:
1. **ESL** (Event Socket) on port 8021 — for sending commands
2. **MRF callback** on `FREESWITCH_LISTEN_ADDRESS:FREESWITCH_LISTEN_PORT` — FS connects back to your app

The MRF profile used is `drachtio_mrf`. The `mrf.connect()` call specifies this profile name.

## PSTN Forwarding

Users can configure PSTN forwarding with a target:
- **Empty target** → routes incoming PSTN calls to user's own browser extension
- **Extension number** (e.g. `1002`) → routes to that registered extension
- **IVR entry** (e.g. `5000`) → routes to the IVR system

The trunk inbound handler resolves the target via `DialPlanService.resolve()` which returns a `RouteType` (Internal, IVR, etc.) and routes accordingly. If the target extension is not registered and it's not an IVR, the call is rejected with 480 Temporarily Unavailable.
