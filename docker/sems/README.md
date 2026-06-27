# SEMS — optional alternative media server (NOT wired into the live stack)

This directory is a **self-contained, opt-in** setup for
[SEMS (SIP Express Media Server)](https://github.com/sems-server/sems).
It is kept here purely **as an option / reference**. Nothing in this folder is
referenced by `docker-compose.dev.yml`, `docker-compose.prod.yml`, the Node
server, the Go API, or the web app. You can build/run it independently, and
delete the whole `docker/sems/` folder with zero impact on the rest of CallNet.

## What SEMS is (and how it relates to what you already run)

SEMS is a C++ **media-plane engine** — the same *category* of component as
**FreeSWITCH**, which the live stack already uses as its MRF (IVR, voicemail,
conference, queue). SEMS is **not** a SIP proxy/registrar (that role is filled
by drachtio); it complements a proxy by doing server-side audio:

- **SBC / B2BUA** (`sbc` app): RTP relay, NAT handling, **audio transcoding /
  codec mapping** (e.g. PCMU/PCMA ⇄ Opus), header manipulation, session timers.
- Announcements, voicemail, conferencing.
- App scripting via DSM state machines or embedded Python (`ivr` / `py_sems`).

> ⚠️ In the current architecture SEMS would **overlap FreeSWITCH**. Don't enable
> it in production unless you have a specific reason (e.g. you want a dedicated,
> lightweight SBC/transcoder in front of carrier trunks). This is a parked
> option, not a recommended default.

## Layout

```
docker/sems/
├── README.md                 ← this file
├── Dockerfile                ← builds SEMS from source (no official image exists)
├── docker-compose.sems.yml   ← opt-in compose (own network by default)
├── .dockerignore
└── conf/                     ← mounted to /usr/local/etc/sems inside the container
    ├── sems.conf             ← core config (bind IPs, ports, plugins, default app)
    └── etc/
        ├── announcement.conf
        ├── conference.conf
        ├── voicemail.conf
        ├── sbc.conf
        └── transcode.sbcprofile.conf  ← SBC transcoding profile (the headline use case)
```

## Build & run (isolated)

From `docker/sems/`:

```bash
# Build the image (first build is slow — compiles SEMS from source)
docker compose -f docker-compose.sems.yml build

# Run it
docker compose -f docker-compose.sems.yml up -d

# Logs
docker compose -f docker-compose.sems.yml logs -f

# Stop & remove
docker compose -f docker-compose.sems.yml down
```

By default it listens on **SIP `0.0.0.0:5080`** (UDP+TCP) and RTP on
**20000–20100/udp**, chosen to avoid clashing with drachtio (`5060`) and the
FreeSWITCH MRF profile (`5090`).

## Pinning the SEMS version

The Dockerfile builds the `2.1.0` release tag by default. Override it:

```bash
docker compose -f docker-compose.sems.yml build --build-arg SEMS_REF=master
```

## Letting SEMS reach drachtio / FreeSWITCH (optional)

By default this compose creates its **own** network (`semsnet`) so it stays fully
isolated. If you later want SEMS to talk to the rest of the stack, attach it to
the live network instead. The dev compose project is named `voip-stack`, so its
network is `voip-stack_voipnet`. Uncomment the `external` network block at the
bottom of `docker-compose.sems.yml` and start the main stack first.

## Headline example: SBC transcoding (PSTN ⇄ WebRTC)

`conf/etc/transcode.sbcprofile.conf` is a starter B2BUA profile that relays RTP
and transcodes between narrowband PSTN codecs (PCMU/PCMA) and Opus. This is the
one place SEMS *could* help the documented "PSTN↔browser media transcoding" gap —
though FreeSWITCH (already in the stack) can do the same job.

## Note on the config files

These `.conf` files are **starter templates** matching SEMS conventions. Exact
directive names occasionally change between SEMS releases — validate against the
`doc/` examples shipped with the version you build (`/usr/src/sems/doc` inside
the build, or the upstream repo). They are intentionally conservative and
heavily commented so you can adapt them.
