# Enjoys Voice — WebRTC Phone System

Real browser-based phone calls with microphone audio, an IVR flow builder, voicemail,
call recording, and SIP trunking for PSTN.

## Architecture

A **hybrid backend**: a Bun/TypeScript SIP engine owns the live telephony, a Go REST
API owns authentication and durable data, and a Next.js PWA talks to both. Postgres is
the shared database; Valkey/Redis is the shared cache.

```
                         ┌─────────────────────────────┐
                         │      Browser (Web PWA)       │
                         │   Next.js 15 · React 19      │
                         │   SIP.js · WebRTC · Zustand  │
                         └───┬─────────┬─────────┬──────┘
            SIP over WS:5065 │  WS:3002│ HTTP    │ HTTP
            (media/calls)    │ (signal)│ :3001   │ :3003
                             ▼         ▼         ▼
            ┌────────────────────────────────┐ ┌────────────────────┐
            │   Node SIP Engine (Bun/TS)     │ │   Go REST API      │
            │   • SIP signalling + routing   │ │   • Auth / JWT     │
            │   • Presence, live call status │ │   • Account mgmt   │
            │   • IVR runtime, recording     │ │   • IVR flow store │
            │   • Voicemail capture          │ │   • Shared CRUD    │
            │   HTTP :3001 · WS :3002        │ │   HTTP :3003       │
            └───────┬────────────────────────┘ └─────────┬──────────┘
                    │ TCP:9022 (control)                  │
                    ▼                       ┌─────────────┴───────────┐
            ┌───────────────┐  ┌──────────┐ │ Postgres :5432          │
            │   Drachtio    │◄►│FreeSWITCH│ │ Valkey/Redis :6379      │
            │  SIP proxy    │  │  media   │ │ (shared by both back-   │
            │  5060 / 5065  │  │ 8021 ESL │ │  ends)                  │
            └───────────────┘  └──────────┘ └─────────────────────────┘
```

### Who owns what

| Concern | Service | Port |
|---|---|---|
| Auth (login / signup / refresh / `me` / rename) | **Go API** | 3003 |
| IVR flow builder persistence | **Go API** | 3003 |
| Account / settings CRUD (shared Postgres) | **Go API** | 3003 |
| SIP signalling, call routing, presence | **Node engine** | SIP 5060/5065 |
| Live status, users, call history (recents) | **Node engine** | HTTP 3001 |
| Presence / call-event signalling, recording relay | **Node engine** | WS 3002 |
| IVR runtime, voicemail capture | **Node engine** | — |
| Web UI (PWA) | **Next.js** | 3000 |

## Tech Stack

- **Node engine** (`src/`) — Bun, TypeScript, Express, `ws`, drachtio-srf / drachtio-fsmrf, `pg`, `redis`
- **Go API** (`api/`) — Go, gin, gorm, go-redis, golang-jwt, bcrypt
- **Web** (`web/`) — Next.js 15, React 19, SIP.js, Zustand, Tailwind, shadcn/ui
- **Infra** — Postgres, Valkey/Redis, Drachtio, FreeSWITCH (via Docker)

## Ports

| Port | Service |
|------|---------|
| 3000 | Web UI (Next.js) |
| 3001 | Node HTTP API (live status, calls, voicemail) |
| 3002 | Node WebSocket (signalling) |
| 3003 | Go REST API (auth, IVR, CRUD) |
| 5060 | SIP (Drachtio, UDP/TCP) |
| 5065 | SIP over WebSocket (browser SIP.js) |
| 5432 | Postgres |
| 6379 | Valkey/Redis |
| 8021 | FreeSWITCH ESL (internal) |
| 9022 | Drachtio admin (internal) |

## Quick Start (local dev)

### 1. Infrastructure (Postgres + Redis)
```bash
cd docker
docker compose up -d postgres redis
```
Database migrations in `api/migrations/` are applied by the Go API on boot (they are
idempotent and also seed the test users below).

### 2. Go REST API (auth + data) — port 3003
```bash
cd api
go run .
```

### 3. Node SIP Engine (telephony) — ports 3001 / 3002 / SIP
```bash
cp .env.example .env    # edit with your settings (see SETUP.md)
bun install
bun run dev
```

### 4. Web UI — port 3000
```bash
cd web
bun install            # or: npm install
bun dev                # or: npm run dev
```

### 5. Make a test call
1. Open http://localhost:3000
2. Log in as `1001` / `password123`
3. In a second browser tab, log in as `1002` / `password123`
4. In **Contacts**, click the call button next to the other user
5. Accept the incoming call in the other tab — you now have a live WebRTC audio call

> Login is by **username (= extension)** + password. The same credentials work via
> `POST :3003/api/auth`.

## Test Users

Password for all three is `password123`; log in by **username (= extension)**. These
match the running dev database; the seed lives in
[api/migrations/001_initial.sql](api/migrations/001_initial.sql).

| Extension / Username | Name           | Mobile     |
|----------------------|----------------|------------|
| 1001                 | Alice Anderson | 9000000001 |
| 1002                 | Bob Brown      | 9000000002 |
| 1003                 | Carol Clark    | 9000000003 |

New accounts can be created via the signup screen or `POST :3003/api/auth/signup`
(the extension is derived from the mobile number).

## Selected API Endpoints

### Go API (`:3003/api`) — auth & data
| Method | Path | Description |
|--------|------|-------------|
| POST   | `/auth` · `/auth/login` | Log in, returns JWT pair + SIP config |
| POST   | `/auth/signup` | Create account |
| POST   | `/auth/refresh` | Exchange refresh token for a new pair |
| GET    | `/auth/me` | Current session profile (boot validator) |
| PATCH  | `/auth/me` | Update the signed-in user's name |
| GET/POST/PUT/DELETE | `/ivr/flows` | IVR flow builder persistence |
| GET    | `/voicemails/:ext` | List voicemails |

### Node engine (`:3001/api`) — live telephony
| Method | Path | Description |
|--------|------|-------------|
| GET    | `/health` | Engine status (SIP connected, IVR, trunk, uptime) |
| GET    | `/users` | Registered SIP users + presence |
| GET    | `/calls` · `/calls/:ext` | Call history (recents) |
| GET/POST | `/block/:ext` | Block list |
| GET/POST | `/forwarding/:ext` | Call forwarding rules |
| POST   | `/ivr/transfer` | Transfer an active call |

## SIP Trunk (PSTN)

Outbound/inbound PSTN calls go through a SIP trunk (e.g. Twilio Elastic SIP Trunking).
Configure it via `TRUNK_*` environment variables (leave `TRUNK_HOST` empty to disable
and run internal-only):

```bash
TRUNK_HOST=yourtrunk.pstn.twilio.com
TRUNK_PORT=5060
TRUNK_TRANSPORT=udp
TRUNK_USERNAME=...
TRUNK_PASSWORD=...
TRUNK_CALLER_NUMBER=+15551234567
```

With no trunk configured the system runs in **internal-only mode** — calls between
registered users via WebRTC, no external dependency. See [SETUP.md](SETUP.md) for the
full trunk + FreeSWITCH walkthrough.

## Docker (full SIP stack)

```bash
cd docker
docker compose up -d
```

Starts Drachtio, FreeSWITCH, Postgres and Redis. Production compose and reverse-proxy
config live in [prod/](prod/) (`docker-compose.prod.yml`, Caddy, coTURN).

## Project Structure

```
.            Node SIP engine (Bun/TS)  — src/, package.json
api/         Go REST API               — main.go, internal/, migrations/
web/         Next.js web PWA           — app/, components/
docker/      Local infra + SIP stack   — docker-compose.yml
prod/        Production deploy          — Caddy, coTURN, compose
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for call-flow diagrams and [SETUP.md](SETUP.md)
for production deployment.

## Features

- Real microphone audio via WebRTC (P2P or through FreeSWITCH)
- DTMF dial pad with tone generation
- Call timer, audio-level visualizer, mute controls
- Incoming-call notifications with accept/reject
- Online user presence
- Call history (recents) and voicemail with in-browser playback
- IVR flow builder (visual, persisted in Postgres)
- Call recording
- JWT authentication with refresh + boot-time session validation
- SIP trunk for PSTN; internal-only mode with no external dependency

## Reference Links
- https://hub.docker.com/r/safarov/freeswitch/
- https://hub.docker.com/r/mlan/asterisk
- https://github.com/drachtio/docker-drachtio-freeswitch-mrf
- https://github.com/PatrickBaus/freeswitch-docker