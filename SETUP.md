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
| 3003 | TCP | Media Stream WS | Twilio Media Streams (wss in prod). Only if `MEDIA_STREAM_ENABLED=true` |
| 3005 | TCP | Browser Bridge WS | Browser listen/talk audio. Internal/LAN only — never exposed to Twilio |
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

> The Compose files are split: **local dev** is `docker/docker-compose.dev.yml` and
> **production** is `docker/docker-compose.prod.yml` (with Caddy + coTURN configured
> under [prod/](prod/)). The interactive [`run.sh`](run.sh) helper wraps both
> (pick env → action → service), so you rarely type raw `docker compose` commands.

### 1. Docker Compose (`docker/docker-compose.dev.yml`)

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
docker compose -f docker-compose.dev.yml up -d --force-recreate drachtio-freeswitch
```


### 4. TLS/SSL Certificates

For production, SIP WebSocket MUST use WSS (TLS). In this stack **Caddy** is the single
public HTTPS entrypoint (`voice.enjoys.in`, automatic Let's Encrypt) and reverse-proxies
by path. The browser connects `wss://DOMAIN/sip`; Caddy terminates the public TLS and
**re-encrypts** to drachtio's own WSS listener on **`:5066`** (drachtio terminates real
TLS via its `<tls>` block so the socket transport matches SIP.js's `Via: SIP/2.0/WSS` —
a plain-`ws` upstream behind TLS-termination is rejected with `400 Bad Request,
invalid transport`). The prod drachtio config also drops known SIP scanners via a
`<spammers>` block, and the `:9022` control socket is **internal-only** (server-to-server
between Node and drachtio), with its secret injected at runtime via
`drachtio --password ${DRACHTIO_SECRET}` rather than the committed default.

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
docker compose -f docker-compose.dev.yml up -d drachtio-server drachtio-freeswitch
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

## PSTN → Browser via Twilio Media Streams (webhook path)

This is a **second, independent inbound path** that does NOT use the SIP trunk /
FreeSWITCH. A call to your **Twilio number** hits an HTTP webhook on the Bun API,
which answers with TwiML that opens a two-way audio **WebSocket** (`<Connect><Stream>`).
The API then routes that audio per call: bridge it to the owner's **browser**, hand it
to the **AI** agent, **forward** it, send it to **voicemail**, or **reject** it.

```
Caller (PSTN) ──▶ Twilio number
     │  1. POST /api/n/media/voice            (HTTPS, form-encoded)
     ▼
CallNet API (Bun)  ──decideCall(To, From, db)──▶  TwiML
     │  2. <Connect><Stream url="wss://…/media?token=…">  (μ-law 8k, two-way)
     ▼
Media Stream WS :3003 ──(mode=bridge)──▶ Browser Bridge WS :3005 ──▶ browser page
                       └─(mode=ai)─────▶ Speechmatics ASR → LLM → TTS
```

### Decision chain (what the caller gets)

| Order | Condition | Result |
|-------|-----------|--------|
| 1 | Called number is not a registered owner DID | `Reject` (no-did) |
| 2 | Caller is on the owner's block list | `Reject` (blocked) |
| 3 | Owner is **online** (SIP-registered) | **Bridge** → rings the browser |
| 4 | Offline + `forwardOnUnavailable` set | **Forward** (`<Dial>`) |
| 5 | Offline + `MEDIA_STREAM_AI_ENABLED=true` | **AI** answers |
| 6 | Offline + `VOICEMAIL_ENABLED=true` | **Voicemail** (`<Record>`) |
| 7 | Offline + none of the above | `Reject` (unavailable) |

> At HTTP answer-time Twilio only knows *registered or not*, so SIP "busy" /
> "no-answer" collapse into the single **offline** branch. Detecting
> *browser-rang-but-nobody-answered* needs a Twilio **Stream status callback**
> (future enhancement).

### Endpoints (mounted at `/api/n/media`, only when enabled)

| Method | Path | Purpose |
|--------|------|---------|
| POST/GET | `/api/n/media/voice` | **Twilio Voice URL** — returns the routing TwiML |
| POST | `/api/n/media/voicemail-status` | Twilio recording-status callback → stores the voicemail |
| GET | `/api/n/media/bridge` | Built-in browser listen/talk **test page** |

These are mounted **before** the API rate-limiter and auth guards (Twilio is an
unauthenticated server-to-server caller). Access is protected instead by the
`?token=` shared secret on the media WebSocket.

### Step 1 — Environment variables

Add to `.env` (the whole feature is gated by `MEDIA_STREAM_ENABLED`):

```bash
# ─── Media Streaming (Twilio PSTN → browser/AI/voicemail) ──────
MEDIA_STREAM_ENABLED=true
MEDIA_STREAM_WS_PORT=3003                       # local media WS port
MEDIA_STREAM_BRIDGE_PORT=3005                   # browser listen/talk WS (LAN only)
MEDIA_STREAM_MODE=auto                          # auto | bridge | ai | log
MEDIA_STREAM_AUTH_TOKEN=CHANGE_ME_STREAM_SECRET # validated on the WS handshake

# Public URLs Twilio dials back (set in prod / when tunneling):
MEDIA_STREAM_PUBLIC_URL=wss://your-domain.com/media       # wss base for <Stream>
MEDIA_STREAM_PUBLIC_HTTP_URL=https://your-domain.com      # https base for callbacks

# ─── AI fallback (optional offline path) ──────────────────────
MEDIA_STREAM_AI_ENABLED=false                   # true to let AI answer when offline
SPEECHMATICS_API_KEY=                            # required if AI enabled (real ASR)
SPEECHMATICS_RT_URL=                             # optional region endpoint
MEDIA_STREAM_AI_LANGUAGE=en

# ─── Voicemail (shared with the SIP/IVR voicemail store) ──────
VOICEMAIL_ENABLED=true
MAX_VOICEMAIL_SEC=180
```

`MEDIA_STREAM_MODE=auto` (the default) runs **both** the bridge and AI handler
stacks and dispatches each call by the `mode` parameter the webhook injects.
Force a single behaviour with `bridge`, `ai`, or `log` (frame logging only).

### Step 2 — Mark which user owns the Twilio number

The router matches the **called number** (`To`) to a user by the **last 10 digits**
of their `mobile`, and only if `pstnForwardToBrowser` is enabled. The bridge target
is `pstnForwardTarget` or, if empty, the user's own `extension`. Set this per user
(via the dashboard API or DB):

```text
user.mobile               = +1 415 555 0123   # = your Twilio number
user.pstnForwardToBrowser = true
user.pstnForwardTarget    = 1001              # optional; defaults to user.extension
```

Optional per-user offline settings the chain reads: `blockedNumbers[]`,
`forwardOnUnavailable` (the forward target).

### Step 3 — Configure the Twilio number

In the Twilio Console → **Phone Numbers → your number → Voice Configuration**:

- **A call comes in** → *Webhook* → `https://your-domain.com/api/n/media/voice` → **HTTP POST**

That is the only required setting. The voicemail recording callback URL is built
automatically from `MEDIA_STREAM_PUBLIC_HTTP_URL` (or the request host).

### Step 4 — Expose the media WebSocket (wss)

Twilio Media Streams **require `wss://`**. Reverse-proxy a public `/media` path to
the local media WS port `3003` (Caddy example):

```caddy
your-domain.com {
    # … existing site config (frontend, /api, etc.) …

    # Twilio Media Streams → media WS server
    @media path /media /media/*
    reverse_proxy @media 127.0.0.1:3003
}
```

Nginx equivalent:

```nginx
location /media {
    proxy_pass http://127.0.0.1:3003;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

Then set `MEDIA_STREAM_PUBLIC_URL=wss://your-domain.com/media`. Port `3005`
(browser bridge) stays internal — only your dashboard/browser connects to it.

### Step 5 — Run and test

```bash
# start the API with streaming on
MEDIA_STREAM_ENABLED=true bun dev
# startup log should show:  Media: enabled (mode=auto, ws :3003)
```

Local testing without a domain (e.g. ngrok / cloudflared) — expose **both** the
HTTP API (3001) and the media WS (3003):

```bash
ngrok http 3001        # → https tunnel for the Voice webhook
ngrok http 3003        # → wss tunnel for <Connect><Stream>
# then set:
#   MEDIA_STREAM_PUBLIC_HTTP_URL = https://<3001-tunnel>
#   MEDIA_STREAM_PUBLIC_URL      = wss://<3003-tunnel>
# Twilio Voice URL = https://<3001-tunnel>/api/n/media/voice
```

Open the built-in test page to act as the "browser" leg, pairing on the target
extension (`?id=` = the bridge target, e.g. `1001`):

```text
http://localhost:3001/api/n/media/bridge?id=1001
# Click Connect, allow the mic, then call your Twilio number.
```

Quick TwiML sanity check (no real call needed):

```bash
curl -s -X POST https://your-domain.com/api/n/media/voice \
  -d 'To=+14155550123' -d 'From=+14155559999'
# → <Response>… one of <Connect><Stream>, <Dial>, <Record>, or <Reject> …</Response>
```

### Notes & current limitations

- Audio is **G.711 μ-law 8 kHz** (Twilio's format). The browser bridge converts
  μ-law ↔ PCM16; the AI path feeds μ-law straight to Speechmatics (no transcode).
- Voicemails captured here store Twilio's hosted `RecordingUrl` in the shared
  `voicemails` table (durable, visible to the dashboard). Downloading the audio
  into the local FreeSWITCH voicemail store is a follow-up.
- The AI branch needs `MEDIA_STREAM_AI_ENABLED=true` **and** `SPEECHMATICS_API_KEY`.
  ASR is real; the LLM responder and TTS synthesizer are pluggable stubs today.
- This path is fully independent of the SIP trunk. You can run either, or both.
