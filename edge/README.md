# CallNet Edge Appliance (native — no Docker)

A **branch-survivable PBX** that runs **natively** on a small box on the customer
LAN (NUC/mini-PC or Raspberry Pi). No containers — FreeSWITCH and coturn run as
ordinary systemd services, and the sync agent is a **single static Go binary**
(~6 MB, zero runtime deps). The box keeps phones working — internal calls,
voicemail, emergency, and **outbound via a local trunk** — even when the WAN to
the central VPS is down.

```
┌──────────────────── Customer site (LAN) ────────────────────┐
│  phones ──register──▶ FreeSWITCH (registrar + media + VM)    │
│                         │            │                       │
│                         │            └─ local SIP/GSM trunk ──┼──▶ PSTN
│                       coturn (LAN TURN for WebRTC softphones) │
│                       callnet-edge-agent ────────────────────┼──▶ central VPS
└──────────────────────────────────────────────────────────────┘
        (WAN down ⇒ everything above the line still works)
```

## Components

| Piece | What | How it runs |
| --- | --- | --- |
| FreeSWITCH | Standalone PBX: registrar, media, voicemail, inbound/outbound via the local trunk. | `freeswitch.service` (native pkg/build) + the overlays in `freeswitch/config/`. |
| coturn | LAN TURN/STUN for browser softphones. | `coturn.service`, `/etc/turnserver.conf` rendered by `install.sh`. |
| `callnet-edge-agent` | Pulls extensions + trunk creds **down**; pushes CDR + voicemail **up**; drives FreeSWITCH over loopback ESL. | Static Go binary → `callnet-edge-agent.service`. |

The FreeSWITCH pieces are **additive overlays** on a stock vanilla config (we
don't replace the whole `/etc/freeswitch`): a loopback ESL, the `callnet_trunk`
gateway, a survivability dialplan (`dialplan/default/00_callnet_edge.xml`), an
inbound map, and synced directory users.

## Build (single static binary, multi-arch)

From a dev machine with Go (cross-compiles from any OS):

```bash
cd edge
./build.sh        # -> dist/callnet-edge-agent-linux-{amd64,arm64}
```

No CGO, no libc — one file copies onto any Debian/Ubuntu/Raspberry Pi OS box.

## Install on the box

```bash
# copy the edge/ dir (with dist/) to the appliance, then:
sudo ENV_FILE=/etc/callnet-edge/agent.env ./install.sh
sudo nano /etc/callnet-edge/agent.env     # device id/token, TURN ip + password
sudo systemctl restart callnet-edge-agent
journalctl -u callnet-edge-agent -f
```

`install.sh` picks the right binary for the CPU, installs coturn from apt, deploys
the FreeSWITCH overlays, renders `/etc/turnserver.conf`, and enables all three
services.

### FreeSWITCH (no longer a manual step)

Build the FreeSWITCH `.deb` (amd64 + arm64) once with
[`packaging/freeswitch/build-deb.sh`](packaging/freeswitch) (or the
`edge-freeswitch-deb` CI workflow), drop it into `edge/packages/`, and
`install.sh` installs it automatically on first run — no SignalWire token, arm64
included. See [packaging/freeswitch/README.md](packaging/freeswitch/README.md).

## Behaviour: online vs WAN-down

| | WAN up | WAN down |
| --- | --- | --- |
| Internal ext↔ext / voicemail | ✅ local | ✅ local |
| Emergency (911/112/…) | ✅ local trunk | ✅ local trunk |
| Outbound PSTN | ✅ local trunk | ✅ local trunk |
| Inbound DID | ✅ local trunk | ✅ local trunk |
| Config changes from central | ✅ applied | ⏸ deferred |
| CDR / voicemail to central | ✅ shipped | ⏸ buffered, flushed on reconnect |

## Central API (BUILT — Go `server/`: `models/edge.go`, `service/edge_service.go`, `handler/edge_handler.go`)

Authenticated by the per-device token: `Authorization: Bearer <token>` +
`X-Device-Id: <deviceId>` (the id is in the header, not the path).

**Device sync surface** (what the agent calls):

```
GET  /api/g/edge/health              200 when reachable
GET  /api/g/edge/extensions          -> EdgeExtension[]  (in `data`)
GET  /api/g/edge/trunk               -> EdgeTrunk | 404
POST /api/g/edge/cdr   {rows:[...]}    -> ack (stored in edge_cdrs)
POST /api/g/edge/voicemail (multipart "file") -> stored under VOICEMAIL_DIR/edge/<deviceId>/
```

**Admin provisioning** (JWT + `ADMIN_EXTENSIONS`):

```
GET    /api/g/edge-devices            list devices
POST   /api/g/edge-devices            create -> returns `token` ONCE
GET    /api/g/edge-devices/:id
PUT    /api/g/edge-devices/:id        update (extensions, trunk, active, rotate_token)
DELETE /api/g/edge-devices/:id
```

Provision a box: `POST /api/g/edge-devices` with
`{ device_id, name, extensions:["1001","1002"], trunk_username, trunk_password, trunk_realm, trunk_proxy }`
→ copy the returned `token` into the box's `/etc/callnet-edge/agent.env`
(`DEVICE_ID` + `DEVICE_TOKEN`).

## Open seams / next steps

1. **CDR → rating/dashboard**: edge CDRs land in the `edge_cdrs` table; wiring them
   into the Node rating engine + admin call history is a follow-up.
2. **Run the FreeSWITCH `.deb` build** (the `edge-freeswitch-deb` CI workflow or
   `packaging/freeswitch/build-deb.sh`) to produce the amd64 + arm64 packages,
   then drop them in `edge/packages/`. Recipe is built; artifacts are on-demand.
3. **mTLS** device enrolment (the bearer token is the bootstrap path today).
4. **DID → extension** map templating in `00_callnet_inbound.xml` (multiple DIDs).
5. **Voicemail dedupe** is filename-based; switch to a server-side idempotency key.
6. **Admin UI** for edge devices (the CRUD API exists; no dashboard tab yet).
