# 📚 LEARNING GUIDE — Enjoys Voice (CallNet)

> A from-scratch study guide to understand this project **and** to prepare for interviews
> in VoIP / real-time communications / backend systems. It goes from **fundamentals**
> (what is SIP, PSTN, a trunk) up to the **advanced internals** actually used in this
> codebase (B2BUA, WebRTC↔PSTN bridging, ICE/STUN/TURN, media transcoding, scaling).
>
> Read top-to-bottom the first time. Later, use it as a quick reference + the
> **Interview Q&A** section at the end to self-test.

---

## Table of Contents

1. [The 10,000-foot view](#1-the-10000-foot-view)
2. [Telephony fundamentals (the vocabulary)](#2-telephony-fundamentals-the-vocabulary)
3. [SIP — Session Initiation Protocol](#3-sip--session-initiation-protocol)
4. [SDP & media negotiation](#4-sdp--media-negotiation)
5. [RTP / RTCP — the actual audio](#5-rtp--rtcp--the-actual-audio)
6. [Codecs & DTMF](#6-codecs--dtmf)
7. [NAT traversal — STUN / TURN / ICE](#7-nat-traversal--stun--turn--ice)
8. [WebRTC — SIP in the browser](#8-webrtc--sip-in-the-browser)
9. [PSTN & SIP trunks](#9-pstn--sip-trunks)
10. [Proxy vs B2BUA vs registrar](#10-proxy-vs-b2bua-vs-registrar)
11. [How THIS project is built](#11-how-this-project-is-built)
12. [Walkthroughs: real call flows in this repo](#12-walkthroughs-real-call-flows-in-this-repo)
13. [IVR, voicemail & media server (FreeSWITCH)](#13-ivr-voicemail--media-server-freeswitch)
14. [Security: toll fraud, TLS, spammers](#14-security-toll-fraud-tls-spammers)
15. [Scaling & production concerns](#15-scaling--production-concerns)
16. [Glossary (every acronym)](#16-glossary-every-acronym)
17. [Interview questions & answers](#17-interview-questions--answers)
18. [Hands-on exercises to learn the codebase](#18-hands-on-exercises-to-learn-the-codebase)

---

## 1. The 10,000-foot view

A phone call has **two completely separate concerns**:

| Concern | "What it does" | Protocols here |
|---|---|---|
| **Signaling** | Set up, modify, and tear down the call. "Ring", "answer", "hang up". | **SIP** (over WS/WSS/UDP/TCP) |
| **Media** | The actual voice audio (and video) flowing between parties. | **RTP/SRTP**, negotiated by **SDP**, codecs like Opus/PCMU |

> 🔑 **The single most important idea in all of VoIP:** *signaling and media travel
> on different paths.* SIP says "let's talk and here's where to send audio"; the audio
> itself flows separately (often peer-to-peer, or anchored through a media server).

This project connects three "worlds":

```
  Browser phone (WebRTC + SIP.js)  ⇄  Your server (drachtio + FreeSWITCH)  ⇄  PSTN (real phones, via a SIP trunk)
       Opus / DTLS-SRTP / ICE              SIP B2BUA + media anchor               PCMU / RTP / SIP trunk
```

---

## 2. Telephony fundamentals (the vocabulary)

- **PSTN** — *Public Switched Telephone Network*. The traditional global phone network
  (landlines + mobile). When you "call a real phone number", you reach the PSTN.
- **VoIP** — *Voice over IP*. Carrying calls over the internet instead of dedicated phone lines.
- **DID** — *Direct Inward Dialing*. A real phone number that routes inbound PSTN calls to
  your system (e.g. a number you rent from Twilio). In this repo a user's `mobile` field
  can act as a DID that rings their browser.
- **Extension** — a short internal number (e.g. `1001`, `1002`) identifying a user **inside**
  your PBX. Not dialable from the outside PSTN directly.
- **PBX** — *Private Branch Exchange*. A phone system serving an organization (handles
  internal extensions, IVR, voicemail, and connects out to the PSTN). **This project is
  essentially a software PBX.**
- **UAC / UAS** — *User Agent Client* (sends the request, e.g. the caller) / *User Agent
  Server* (receives it, e.g. the callee). A single device is a *User Agent (UA)* and
  switches roles per transaction.
- **Registrar** — the server that tracks "which user is reachable at which network address
  right now" (via SIP REGISTER). Without it, the server wouldn't know where to send an
  incoming call for `1001`.
- **E.164** — the international phone-number format: `+` country-code + number, max 15
  digits, e.g. `+919876543210`. Trunk providers expect E.164. This repo normalizes to it.

---

## 3. SIP — Session Initiation Protocol

**SIP** is a text-based request/response protocol (looks a lot like HTTP) used to
**create, modify, and end** real-time sessions.

### 3.1 SIP methods (requests)

| Method | Meaning |
|---|---|
| `REGISTER` | "I am extension 1001, reachable at this address." (tells the registrar) |
| `INVITE` | "Let's start a call." Carries an SDP offer. |
| `ACK` | Confirms the final response to an INVITE. |
| `BYE` | "Hang up." |
| `CANCEL` | "Stop ringing, I gave up before you answered." |
| `OPTIONS` | Capability/keepalive ping. |
| `INFO` | Mid-call info (e.g. DTMF in some setups). |
| `REFER` | "Transfer this call to X." |
| `SUBSCRIBE` / `NOTIFY` | Event subscriptions (presence, voicemail waiting). |
| `MESSAGE` | Instant message over SIP. |

### 3.2 SIP responses (like HTTP status codes)

| Class | Examples | Meaning |
|---|---|---|
| **1xx** Provisional | `100 Trying`, `180 Ringing`, `183 Session Progress` | In progress |
| **2xx** Success | `200 OK` | Answered / accepted |
| **3xx** Redirect | `302 Moved Temporarily` | Try elsewhere |
| **4xx** Client error | `401/407` (auth), `403 Forbidden`, `404 Not Found`, `408 Timeout`, `486 Busy Here`, `487 Request Terminated` | Request problem |
| **5xx** Server error | `480 Temporarily Unavailable`, `500`, `503 Service Unavailable` | Server problem |
| **6xx** Global failure | `603 Decline`, `410 Gone` | Definitive failure |

> 💡 This repo uses many of these as routing signals — e.g. a stale registration returns
> **`410 Gone`**, busy is **`486`**, no-answer is **`408`/timeout**, and unreachable falls
> through a chain ending in **`480`**. See `src/core/types.ts` (`SipStatus`) and
> `SipServer.routeUnreachable()`.

### 3.3 Anatomy of a SIP message

```
INVITE sip:1002@enjoys.in SIP/2.0
Via: SIP/2.0/WSS abcd.invalid;branch=z9hG4bK...     ← path the request took (transport!)
From: "Alice" <sip:1001@enjoys.in>;tag=111
To: <sip:1002@enjoys.in>
Call-ID: a84b4c76e66710@host                          ← unique per dialog
CSeq: 1 INVITE                                         ← sequence number + method
Contact: <sip:1001@abcd.invalid;transport=ws>         ← where to reach me directly
Max-Forwards: 70
User-Agent: Enjoys.in Voice/1.0                        ← we rebranded this (was SIP.js/0.21.1)
Content-Type: application/sdp
Content-Length: ...

v=0 ...                                                ← SDP body (media offer) starts here
```

Key headers to **know cold for interviews**:

- **Via** — records the transport + each hop; responses follow it back. The `branch`
  parameter identifies the transaction. ⚠️ *In this project the **Via transport** caused
  the famous `400 Bad Request "invalid transport WSS"` bug — see §14.*
- **From / To** — logical endpoints; **tags** make the dialog unique.
- **Call-ID** — identifies the whole call/dialog. ⚠️ In a B2BUA you must **not** reuse the
  same Call-ID on both legs (see repo memory: "dialog already exists").
- **CSeq** — orders requests within a dialog.
- **Contact** — the direct reachable address (vs the logical `To`/`From`).

### 3.4 Transactions vs dialogs

- **Transaction** = one request + its responses (e.g. the INVITE→200 exchange).
- **Dialog** = the whole conversation between two UAs (from INVITE/200/ACK until BYE),
  identified by `Call-ID` + both tags.

### 3.5 SIP transports

SIP can run over **UDP**, **TCP**, **TLS**, **WS** (WebSocket), or **WSS** (secure
WebSocket). Browsers can only do **WS/WSS** — that's why WebRTC SIP phones use SIP-over-WebSocket. This project:
- Browser → server: **WSS** (`wss://voice.enjoys.in/sip`) in prod, `ws` locally on `:5065`.
- Server ↔ PSTN trunk: typically **UDP/TCP** on `:5060`.

---

## 4. SDP & media negotiation

**SDP** = *Session Description Protocol*. It is **not** a transport — it's a text
**description** carried inside SIP bodies (in the INVITE and the 200 OK) that answers:
*"what media, which codecs, and what IP/port should I send audio to?"*

```
v=0                                   ← version
o=- 20518 0 IN IP4 203.0.113.1        ← origin
s=-                                   ← session name
c=IN IP4 203.0.113.1                  ← connection address (where to send media)
t=0 0                                 ← timing
m=audio 49170 RTP/AVP 0 8 101         ← media: audio, port 49170, codecs 0(PCMU) 8(PCMA) 101(DTMF)
a=rtpmap:0 PCMU/8000                  ← codec 0 = G.711 µ-law @ 8kHz
a=rtpmap:101 telephone-event/8000     ← DTMF (RFC 2833)
a=sendrecv                            ← direction
```

### Offer/Answer model (RFC 3264)
1. Caller sends **offer** SDP in the INVITE ("I support Opus, PCMU; send media to me here").
2. Callee replies with **answer** SDP in the 200 OK ("let's use PCMU; send media to me there").
3. Both now know each other's media IP/port/codec → RTP flows.

> 🔑 In a **B2BUA** (this project), the server sits in the middle of two offer/answer
> exchanges (one per leg). The repo memory notes a *transparent SDP pass-through*
> (`localSdpA/B: (sdp) => sdp`) for the WebRTC↔WebRTC case — meaning the two browsers
> negotiate media directly. For **WebRTC↔PSTN**, that's NOT enough (different codecs +
> encryption), so media must be **anchored/transcoded** through FreeSWITCH (see §12.3).

---

## 5. RTP / RTCP — the actual audio

- **RTP** — *Real-time Transport Protocol*. Carries the media packets (audio frames),
  usually over UDP. Has sequence numbers + timestamps so the receiver can reorder and
  play smoothly.
- **RTCP** — control/stats sidecar for RTP (jitter, packet loss, round-trip).
- **SRTP** — *Secure RTP*: encrypted RTP. WebRTC **mandates** encryption via **DTLS-SRTP**
  (keys exchanged with DTLS). PSTN/SIP trunks usually use **plain RTP** (or SRTP if
  configured).

> ⚠️ **Why a bare B2BUA gives you a "connected but silent" call between a browser and the
> PSTN:** the browser speaks **DTLS-SRTP + Opus**, the trunk speaks **plain RTP + PCMU**.
> Nobody can decrypt/transcode the other side. You MUST put a media server (FreeSWITCH)
> in the path to bridge them. This exact gap is documented in the repo memory.

---

## 6. Codecs & DTMF

**Codec** = COder/DECoder — compresses/decompresses audio.

| Codec | Payload type | Rate | Where used |
|---|---|---|---|
| **Opus** | dynamic | 8–48 kHz | WebRTC / browsers (high quality, adaptive) |
| **G.711 µ-law (PCMU)** | 0 | 8 kHz | PSTN/telephony standard (North America) |
| **G.711 A-law (PCMA)** | 8 | 8 kHz | PSTN (Europe) |
| **G.722** | 9 | 16 kHz | HD voice |

Browser↔PSTN therefore needs **transcoding** (Opus ⇆ PCMU). This repo even includes a
hand-written **G.711 µ-law ⇆ PCM16 codec** (`src/trunk/streaming/audio.codec.ts`) for the
media-stream/AI bridge path.

**DTMF** = the digits you press during a call ("press 1 for sales"). Three ways to send:
1. **In-band** — actual tones in the audio (fragile across transcoding).
2. **RFC 2833 / 4733** — `telephone-event` RTP payload (most common; the `101` above).
3. **SIP INFO** — digits in SIP messages.

This project's IVR collects DTMF via FreeSWITCH endpoint events (`endpoint.on('dtmf', …)`).

---

## 7. NAT traversal — STUN / TURN / ICE

Most devices sit behind a **NAT** (your router), so their *private* IP (`192.168.x.x`)
isn't reachable from the internet. Media can't flow unless each side learns a routable
address. Three tools:

- **STUN** — *Session Traversal Utilities for NAT*. A lightweight server that tells you
  *"here's how the internet sees you"* (your public IP:port). Cheap, works for most NATs.
  This repo uses Google STUN `stun:stun.l.google.com:19302`.
- **TURN** — *Traversal Using Relays around NAT*. A **relay** server that forwards media
  when direct/STUN paths fail (strict/symmetric NATs). More reliable but costs bandwidth.
  This stack ships a **coturn** TURN server (`prod/coturn/turnserver.conf`).
- **ICE** — *Interactive Connectivity Establishment*. The **algorithm** that gathers all
  possible addresses ("candidates": host, STUN-reflexive, TURN-relayed), pings them in
  priority order, and picks the best working pair.

> 🔑 Interview soundbite: **"STUN discovers, TURN relays, ICE decides."**
> Repo memory: *without STUN ICE servers configured on the SIP.js `UserAgent`, `Inviter`,
> AND `answer()`, the browser can't discover its public IP → ICE fails → no audio.*

---

## 8. WebRTC — SIP in the browser

**WebRTC** lets browsers do real-time audio/video **without plugins**. It provides the
**media** half (getUserMedia, RTCPeerConnection, DTLS-SRTP, ICE) but **not** signaling —
you bring your own. Here, **SIP.js** is the signaling library that speaks **SIP over
WebSocket**, and WebRTC handles the media.

Browser call stack in this repo (`web/app/hooks/useSipPhone.ts`):
- **SIP.js `UserAgent`** connects `wss://…/sip` to drachtio, REGISTERs the extension.
- **`Inviter`** places calls; **`Invitation`** handles incoming ones.
- **`SessionDescriptionHandler`** wires SIP's SDP to the browser's `RTCPeerConnection`,
  injecting the ICE servers (STUN/TURN).
- We set `userAgentString: "Enjoys.in Voice/1.0"` to brand the SIP `User-Agent` header.

```
getUserMedia (mic)  →  RTCPeerConnection  →  DTLS-SRTP/Opus media
        ↑                     ↑
   SIP.js (SDP offer/answer over WSS)  →  drachtio  →  routing/B2BUA
```

---

## 9. PSTN & SIP trunks

A **trunk** is a connection between your phone system and another network — classically a
bundle of phone lines. A **SIP trunk** is the modern version: a **SIP connection to an
*Internet Telephony Service Provider* (ITSP)** that gives you access to the **PSTN**.

- **Outbound:** your PBX sends an INVITE to the trunk provider → they place the call on the
  real phone network. (Billable!)
- **Inbound:** the provider receives a call to your **DID** and sends you an INVITE → you
  route it to the right extension/browser.

This project has two trunk styles:
1. **SIP trunk** (classic): `src/services/trunk.service.ts` + `src/trunk/` providers
   (**Twilio, Telnyx, Plivo, Vonage**). Normalizes numbers to **E.164** and builds an
   outbound SIP URI like `sip:+1555...@sip.telnyx.com`.
2. **Provider REST / media-streams** (Twilio Programmable Voice, `<Connect><Stream>`):
   audio is streamed over a WebSocket to the server for AI/recording/bridging
   (`src/trunk/streaming/`).

> 🔑 Why normalize to **E.164**? Providers reject ambiguous numbers. The repo's rule:
> strip non-digits; a 10-digit `^[6-9]` → `+91` (India mobile), other 10-digit → `+1`,
> else prefix `+`.

---

## 10. Proxy vs B2BUA vs registrar

Three roles a SIP server can play — **know the difference for interviews**:

| Role | What it does | Sees media? | Controls call? |
|---|---|---|---|
| **Registrar** | Records where each user is (REGISTER). | No | No |
| **SIP Proxy** | Forwards SIP messages between UAs; stays mostly out of the way. | No | Limited (just routing) |
| **B2BUA** (Back-to-Back User Agent) | Acts as a UA on **both** sides — terminates one call leg and originates another. Full control. | Optionally (can anchor media) | **Yes** — billing, transfer, recording, fallback |

**drachtio** (used here) is a programmable SIP server: your Node code decides, per request,
whether to proxy, build a **B2BUA** (`createB2BUA`), reject, or route to FreeSWITCH. This
is why the app can implement custom logic like block-lists, call-forwarding chains, IVR,
and voicemail.

> 🔑 A B2BUA is essentially **two glued-together calls** with your logic in the middle.
> That's what enables features a dumb proxy can't do.

---

## 11. How THIS project is built

### 11.1 Components

```
web/      Next.js 15 + React 19 + SIP.js 0.21 + Zustand        → the browser softphone + admin UI
src/      Bun + TypeScript: SIP engine, HTTP API, WS signaling → the brain (drachtio-srf + drachtio-fsmrf)
server/   Go (gin + gorm): auth + persistent CRUD               → system of record (users, IVR flows, audit, calls)
docker/   drachtio-server + FreeSWITCH (MRF) + postgres + redis → infra (local dev)
prod/     docker-compose.prod.yml + Caddy + coturn              → VPS production stack (voice.enjoys.in)
```

### 11.2 Ports (memorize these)

| Port | Service |
|---|---|
| `3001` | Node HTTP/REST API (`/api/n/*`) |
| `3002` | Node signaling WebSocket (presence) |
| `3003` | Go CRUD API (`/api/g/*`) |
| `3004` | Media-stream WebSocket (Twilio/AI) |
| `3005` | Browser-bridge WebSocket (PSTN↔browser audio) |
| `4500` | Next.js web (prod `next start`) |
| `5060` | drachtio SIP (UDP/TCP, trunk/external) |
| `5065` | drachtio SIP-over-WS (local browser SIP.js) |
| `5066` | drachtio SIP-over-WSS (prod, real TLS) |
| `9022` | drachtio control socket (server↔Node, **internal only**) |
| `8021` | FreeSWITCH ESL (Event Socket Library) |

### 11.3 The two-backend split (Node vs Go)

- **Go (`/api/g`)** = system of record: `auth`, `users`, `ivr/flows`, `lookup`, `block`,
  `forwarding`, `audit`, `calls`. Returns a uniform envelope `{success, message, data}`.
- **Node (`/api/n`)** = anything backed by a **live engine service**: `health`, `ivr
  status/recordings/transfer`, `trunk`, `config`, user **presence** (`registered`),
  voicemail audio. (We recently made Node return the **same** `{success, message, data}`
  envelope so both APIs are consistent.)
- They share one Postgres DB; Node mirrors Go-owned tables live via **Postgres
  LISTEN/NOTIFY** (no polling).

### 11.4 Request routing (Caddy)

In prod, **Caddy** is the single HTTPS entrypoint (`:443`) and reverse-proxies by path:
`/` → web, `/api/n/*` → Node, `/api/g/*` → Go, `/sip` → drachtio WSS, `/signal` → signaling
WS, `/bridge` → bridge WS. Caddy also auto-manages TLS certificates.

---

## 12. Walkthroughs: real call flows in this repo

### 12.1 Registration (browser comes online)
1. Browser logs in → Go API returns a JWT + `sipConfig` (`wsUrl`, `sipWsUrl`, `domain`).
2. SIP.js `UserAgent` connects `wss://…/sip` and sends **REGISTER** for the extension.
3. drachtio passes it to Node; Node's registration store records "1001 is online here".
4. Presence (`registered: true`) is now visible to other users via the signaling WS / API.

### 12.2 Internal call (Alice 1001 → Bob 1002), both browsers
1. Alice's browser sends **INVITE** (SDP offer) over WSS → drachtio → Node `handleInvite()`.
2. Node checks block-list, looks up Bob's registration, logs the call.
3. Node builds a **B2BUA** to Bob; Bob's browser **rings** (`180`).
4. Bob answers (`200 OK` + SDP answer); media (Opus/DTLS-SRTP) flows **browser-to-browser**
   (transparent SDP pass-through — no transcoding needed since both are WebRTC).
5. Either side sends **BYE** → both legs torn down; Node writes call history.

If Bob is offline/busy/no-answer → `routeUnreachable()` chain: PSTN-forward to his mobile →
forwarding rules → **voicemail** (FreeSWITCH records) → spoken "unavailable" → `480`.

### 12.3 Inbound PSTN → browser (the hard one)
1. Someone dials your **DID** on a real phone → trunk provider sends **INVITE** to `:5060`.
2. `TrunkInboundHandler` recognizes the source as a trunk, finds the user whose `mobile`
   = that DID and has `pstnForwardToBrowser`, and routes to their extension.
3. B2BUA to the browser → it rings. **BUT:** trunk speaks **PCMU/plain-RTP**, browser
   speaks **Opus/DTLS-SRTP** → a bare B2BUA = *connected but silent*.
4. **Fix:** anchor media through **FreeSWITCH MRF** to transcode + handle DTLS-SRTP/ICE.
   (Documented as the remaining infra gap in repo memory.)

> 🔑 This walkthrough is gold for interviews: it forces you to explain signaling vs media,
> codecs, encryption, B2BUA, and media anchoring all at once.

---

## 13. IVR, voicemail & media server (FreeSWITCH)

- **IVR** — *Interactive Voice Response*: "Press 1 for sales…". Needs a **media server** to
  play prompts and collect DTMF. Here that's **FreeSWITCH** driven via **drachtio-fsmrf**
  (MRF = Media Resource Function).
- **ESL** — *Event Socket Library*: the TCP control channel (`:8021`) used to command
  FreeSWITCH and receive events (DTMF, playback done, etc.).
- **MOH** — *Music On Hold*. Here served via `local_stream://moh`.
- **TTS** — *Text-To-Speech* (FreeSWITCH `mod_flite`) to speak dynamic prompts.
- **Voicemail** — FreeSWITCH records a `.wav`; Node stores metadata; the WAV is streamed
  back to the browser on demand.
- There's also a **visual IVR builder** (`web/app/admin/ivr`) using React Flow, persisting
  flow graphs (nodes: menu/play/condition/transfer/voicemail/hangup) as JSONB in Postgres.

---

## 14. Security: toll fraud, TLS, spammers

- **Toll fraud** — attackers try to make your system place expensive PSTN calls (e.g. to
  premium/international numbers) on your dime. Internet scanners constantly probe public
  `:5060`. **Mitigation in this repo:** an outbound **toll-fraud gate** (only authenticated/
  known callers with a valid route can hit the trunk) + auditing (`call_blocked` events).
- **drachtio `<spammers>` block** — drops known scanner User-Agents
  (`friendly-scanner`, `sipvicious`, `pplsip`, `sip-cli`…) outright.
- **TLS everywhere on the edge** — Caddy terminates HTTPS/WSS for the browser. drachtio
  also terminates real **WSS (`:5066`)** in prod so the SIP `Via: …/WSS` transport matches.
- **The `400 Bad Request "invalid transport WSS"` bug** (great interview war-story):
  SIP.js connects `wss://` so stamps `Via: SIP/2.0/WSS`, but Caddy was **terminating TLS**
  and forwarding plain `ws` to drachtio's `transport=ws` listener. sofia-sip saw "WSS on a
  ws socket" → rejected with **400**. **Fix:** make drachtio terminate **real TLS** on
  `:5066` (its own `<tls>` cert) and have Caddy **re-encrypt** to it. Lesson: *the SIP Via
  transport must match the actual socket transport.*
- **Control socket hardening** — drachtio's `:9022` admin port is **server-to-server only**
  (Node ↔ drachtio); it's bound to loopback locally and only `expose`d on the internal
  Docker network in prod, with the secret injected via env (not the committed default).
- **JWT auth** — access + refresh tokens (HS256). Frontend stores them and refreshes once
  on a `401`.

---

## 15. Scaling & production concerns

- **Stateless vs stateful:** SIP **dialogs** and **registrations** are stateful. To run
  multiple Node instances you need shared state — this repo uses **Redis/Valkey** for the
  registration store + a write-queue, and **Postgres LISTEN/NOTIFY** to keep each instance's
  in-memory view in sync.
- **Media is the bandwidth hog:** signaling is tiny; **media (RTP)** is what consumes
  bandwidth and CPU (especially **transcoding** and **TURN relaying**). Plan capacity around
  concurrent media legs, not call setup rate.
- **Media anchoring trade-off:** anchoring through FreeSWITCH gives control (record, bridge,
  transcode) but costs CPU/bandwidth; letting media go peer-to-peer is cheaper but can't
  bridge incompatible endpoints.
- **NAT/firewall:** open the right ports — SIP `:5060`, the RTP range, TURN. Public `:5060`
  invites scanners, so firewall it when only browsers (via Caddy/WSS) need access.
- **Observability:** call detail records (CDRs / `call_records`), audit logs, and SIP
  traces (`sngrep`, `sofia-loglevel`) are how you debug production.
- **Graceful shutdown:** drain dialogs, flush audit/call queues (the app traps SIGINT/SIGTERM
  and flushes the audit buffer).

---

## 16. Glossary (every acronym)

| Term | Expansion / meaning |
|---|---|
| **B2BUA** | Back-to-Back User Agent — SIP server that terminates + re-originates call legs |
| **CDR** | Call Detail Record — billing/history record of a call |
| **DID** | Direct Inward Dialing — a real number routing inbound to your system |
| **DTLS** | Datagram TLS — used by WebRTC to exchange SRTP keys |
| **DTMF** | Dual-Tone Multi-Frequency — keypad digit tones |
| **E.164** | International phone number format (`+CC…`) |
| **ESL** | Event Socket Library — FreeSWITCH control channel |
| **ICE** | Interactive Connectivity Establishment — NAT path selection |
| **ITSP** | Internet Telephony Service Provider — sells SIP trunks/DIDs |
| **IVR** | Interactive Voice Response — phone menus |
| **MOH** | Music On Hold |
| **MRF** | Media Resource Function — the media server role (FreeSWITCH here) |
| **NAT** | Network Address Translation — private↔public IP mapping |
| **PBX** | Private Branch Exchange — an org's phone system |
| **PSTN** | Public Switched Telephone Network — the real phone network |
| **RTP/RTCP** | Real-time Transport Protocol / its control protocol |
| **SDP** | Session Description Protocol — media description in SIP bodies |
| **SIP** | Session Initiation Protocol — call signaling |
| **SRTP** | Secure RTP — encrypted media |
| **STUN** | Discovers your public IP:port |
| **TURN** | Relays media when direct paths fail |
| **UA / UAC / UAS** | User Agent / Client / Server |
| **VoIP** | Voice over IP |
| **WebRTC** | Browser real-time media stack |
| **WS / WSS** | WebSocket / secure WebSocket (SIP transport for browsers) |

---

## 17. Interview questions & answers

**Q: What's the difference between signaling and media in VoIP?**
A: Signaling (SIP) sets up/tears down the call and negotiates parameters; media (RTP/SRTP)
carries the actual audio. They travel on separate paths — SIP just tells each side where to
send media (via SDP).

**Q: Walk me through what happens when you place a SIP call.**
A: UAC sends `INVITE` with an SDP offer → callee responds `100 Trying`, `180 Ringing`, then
`200 OK` with an SDP answer → caller sends `ACK` → RTP media flows → `BYE` ends it. The
offer/answer in INVITE/200 negotiates codecs and media addresses.

**Q: What is a B2BUA and why use one instead of a proxy?**
A: A B2BUA terminates one call leg and originates another, acting as a UA on both sides.
Unlike a proxy it has full control — it can transfer, record, anchor media, apply billing,
and run custom routing/fallback logic. This project uses drachtio's `createB2BUA`.

**Q: STUN vs TURN vs ICE?**
A: STUN tells you your public IP:port (discovery); TURN relays media when direct paths fail;
ICE is the algorithm that gathers candidate addresses and picks the best working pair.
"STUN discovers, TURN relays, ICE decides."

**Q: Why can a browser↔PSTN call connect but have no audio?**
A: The browser uses Opus + DTLS-SRTP (encrypted); the PSTN trunk uses PCMU + plain RTP.
A bare B2BUA only relays SDP, so neither side can decrypt/decode the other. You must anchor
media through a media server (FreeSWITCH) to transcode and handle DTLS-SRTP/ICE.

**Q: How does a browser do SIP if it can't open UDP sockets?**
A: SIP over WebSocket (WS/WSS). SIP.js handles signaling over WSS; WebRTC handles media
(DTLS-SRTP). That's why drachtio runs a WS/WSS listener (`:5065`/`:5066`).

**Q: What is a SIP trunk and what's E.164?**
A: A SIP trunk is a SIP connection to an ITSP that bridges your PBX to the PSTN (in/outbound
real calls). E.164 is the international number format (`+` country code + number) that
providers require; the app normalizes numbers to it before dialing out.

**Q: What's the role of the registrar and REGISTER?**
A: REGISTER tells the registrar "user X is reachable at this address now". Without it the
server wouldn't know where to send an inbound INVITE for that extension. Registrations
expire and refresh; a stale one here returns `410 Gone`.

**Q: How do you prevent toll fraud?**
A: Authenticate/authorize before allowing outbound trunk calls (a toll-fraud gate), restrict
who can reach `:5060`, drop scanner User-Agents (`<spammers>`), use TLS, audit blocked calls,
and rate-limit. Never let unauthenticated INVITEs reach the trunk.

**Q: Why did the WSS SIP requests fail with 400 here?**
A: SIP.js stamped `Via: …/WSS` but Caddy terminated TLS and forwarded plain `ws`, so the
SIP server saw a WSS Via on a ws socket and rejected it. Fix: terminate real TLS at drachtio
(`:5066`) so the transport matches the Via.

**Q: How would you scale this to multiple instances?**
A: Externalize stateful pieces — registrations and dialogs — into shared stores (Redis/
Valkey), keep per-instance caches in sync (Postgres LISTEN/NOTIFY), put a load balancer in
front, and size capacity around concurrent media legs (the expensive part), considering media
anchoring/TURN bandwidth.

---

## 18. Hands-on exercises to learn the codebase

1. **Trace a REGISTER:** start the stack, log in on the web UI, and follow the SIP REGISTER
   from `web/app/hooks/useSipPhone.ts` → drachtio `:5065` → Node registration store. Confirm
   `/api/n/users` flips `registered: true`.
2. **Trace an internal call:** read `src/sip/sip.server.ts` `handleInvite` and find where
   `createB2BUA` is called. Identify where block-list and call logging happen.
3. **Read the fallback chain:** open `SipServer.routeUnreachable()` and map each SIP status
   (`486/408/480/410`) to its branch (busy / no-answer / unavailable).
4. **Find the media gap:** read `src/trunk/streaming/` and explain why the PSTN↔browser
   bridge needs codec conversion (`audio.codec.ts`) and where DTLS-SRTP would be handled.
5. **Inspect the envelope:** compare `server/internal/response/response.go` with the new
   `src/http/response.ts` and see how both APIs now return `{success, message, data}`.
6. **Security review:** open `docker/drachtio-server/config/drachtio.conf.xml` and explain
   the `<tls>`, `<spammers>`, and `<admin>` blocks, and why `:9022` is internal-only.

---

*Tip: pair this guide with `ARCHITECTURE.md` (call-flow mermaid diagrams) and the inline
code comments — they explain the "why" behind each decision.*
