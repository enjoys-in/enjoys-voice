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

- Linux server (Ubuntu 22.04+ recommended)
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
FREESWITCH_LISTEN_ADDRESS=YOUR_SERVER_PUBLIC_IP   # CRITICAL: must be reachable by FS
FREESWITCH_LISTEN_PORT=8085

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

### 3. FreeSWITCH MRF Profile (`docker/drachtio/drachtio-freeswitch-mrf/config/`)

In the SIP profile XML, update:
```xml
<param name="ext-rtp-ip" value="YOUR_SERVER_PUBLIC_IP"/>
<param name="ext-sip-ip" value="YOUR_SERVER_PUBLIC_IP"/>
<param name="apply-candidate-acl" value="localnet.auto"/>
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
| IVR Connection timeout | RTP ports not reachable | Expose 16384-32768/udp, set ext-rtp-ip |
| WebRTC no audio | NAT traversal failure | Set correct ext-rtp-ip, ensure STUN/TURN |
| SIP register fails | Wrong domain/WS URL | Match DOMAIN env with client config |
| "Lost connection to FreeSWITCH" | Container restarted/ESL unreachable | Check docker logs, verify port 8021 |

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
