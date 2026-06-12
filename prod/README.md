# CallNet — Production Deployment (`prod/`)

Self-contained production stack for the VPS **`77.237.241.24`**.
Nothing here affects your local dev setup (`docker/docker-compose.yml`).

## What's in this folder

| File | Purpose |
|------|---------|
| `docker-compose.prod.yml` | Full stack: Caddy, web, api, drachtio, FreeSWITCH, coturn |
| `.env.production.example` | All env vars — copy to `.env` and fill `REPLACE_ME` |
| `Caddyfile` | Auto-TLS reverse proxy (Let's Encrypt) + WSS routing |
| `coturn/turnserver.conf` | TURN/STUN for WebRTC media across NAT |
| `freeswitch/drachtio_mrf.xml` | MRF profile override with the public IP for RTP |
| `api.Dockerfile` / `web.Dockerfile` | Production images (built from repo root) |

## Architecture

```
Browser ──HTTPS/WSS──> Caddy :443 ─┬─> web   :3000   (UI)
                                   ├─> api   :3001   (/api REST)
                                   ├─> api   :3002   (/signal WS)
                                   └─> drachtio :5065 (/sip SIP-over-WS)

Browser ──SRTP/RTP──> FreeSWITCH :16384-16403   (audio)
Browser ──TURN──────> coturn :3478              (relay fallback)
SIP trunk ──SIP──────> drachtio :5060            (PSTN)
```

## What you must replace (and where)

1. **Domain** — point an A record `voice.enjoys.in → 77.237.241.24`, then set
   `DOMAIN`, `PUBLIC_API_BASE`, `PUBLIC_WS_URL`, `PUBLIC_SIP_WS_URL` in `.env`.
2. **Secrets** — `DRACHTIO_SECRET`, `FREESWITCH_SECRET`, `TURN_PASSWORD` in `.env`.
3. **TURN** — same password in `.env`, `coturn/turnserver.conf`, and the
   `PUBLIC_ICE_SERVERS` credential. Set `realm`/`external-ip` in the conf.
4. **Public IP in FreeSWITCH** — `freeswitch/drachtio_mrf.xml` `ext-rtp-ip` /
   `ext-sip-ip` (already `77.237.241.24` — change only if the IP changes).
5. **SIP trunk** — fill `TRUNK_*` in `.env` for outbound PSTN.

> The backend now reads `PUBLIC_WS_URL` / `PUBLIC_SIP_WS_URL` / `PUBLIC_API_BASE`.
> When unset (local), it falls back to the old `ws://<ip>:<port>` behavior, so
> **local dev is unchanged**.
>
> The **frontend uses RUNTIME config**, not build-time: `web-entrypoint.sh`
> generates `/runtime-config.js` from `PUBLIC_API_BASE` and `PUBLIC_ICE_SERVERS`
> at container start. The same web image works in any environment — change the
> values in `.env` and just restart the `web` container (no rebuild).

## Deploy

```bash
# On the VPS, from this folder:
cp .env.production.example .env
nano .env                      # fill every REPLACE_ME

docker compose -f docker-compose.prod.yml --env-file .env up -d --build
docker compose -f docker-compose.prod.yml logs -f
```

## VPS firewall (open these ports)

| Port | Proto | Why |
|------|-------|-----|
| 80, 443 | TCP | HTTP/HTTPS (Caddy + ACME) |
| 443 | UDP | HTTP/3 (optional) |
| 5060 | UDP/TCP | SIP trunk signaling |
| 16384–16403 | UDP | FreeSWITCH RTP media |
| 3478 | UDP/TCP | TURN/STUN |
| 49152–65535 | UDP | TURN relay range |

**Keep closed/internal:** `9022` (drachtio control), `8021` (FreeSWITCH ESL),
`3001/3002/3000/5065/5090` (reached only through Caddy on the internal network).

## Verify after boot

```bash
# TLS + UI
curl -I https://voice.enjoys.in

# FreeSWITCH MRF profile + TTS module
docker exec callnet-freeswitch fs_cli -p "$FREESWITCH_SECRET" -x "sofia status"
docker exec callnet-freeswitch fs_cli -p "$FREESWITCH_SECRET" -x "module_exists mod_flite"

# TURN reachable
docker logs callnet-coturn | tail
```

Then open `https://voice.enjoys.in`, log in, and place a call to the IVR (`5000`).
Browser DevTools → Network → WS should show a `wss://voice.enjoys.in/sip` connection.
