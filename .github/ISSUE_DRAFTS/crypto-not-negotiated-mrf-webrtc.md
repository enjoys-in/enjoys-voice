# MRF/WebRTC: "Crypto not negotiated but required" — DTLS-SRTP calls fail (dialplan forces SDES on browser leg)

## Summary
Nearly every WebRTC call into the FreeSWITCH MRF fails media negotiation with
`switch_core_media.c:5606 Crypto not negotiated but required`. The browser
offers **DTLS-SRTP**, but the `mrf` dialplan forces **SDES-SRTP** on the inbound
browser leg, so FreeSWITCH requires an `a=crypto` suite that a WebRTC offer never
contains → media fails and the call drops (~3.5s after answer).

## Impact
- IVR / voicemail / conference / queue calls have no audio and drop shortly after
  connect.
- Profile counters confirm the scale:
  `sofia status profile drachtio_mrf` → `CALLS-IN 4020`, `FAILED-CALLS-IN 4018`.

## Environment
- FreeSWITCH MRF: `safarov/freeswitch` 1.10.x, profile `drachtio_mrf` (port 5090).
- Signaling: browser → Caddy (wss) → drachtio-server → drachtio-fsmrf → FreeSWITCH.
- Public IP `77.237.241.24`; media RTP ports 16384–16403/udp published.

## Symptom (logs)
```
<uuid> [WARNING] switch_core_media.c:5606 Crypto not negotiated but required.
```
Repeats once per call attempt, tied to each channel UUID.

## Root-Cause Analysis
`dialplan/mrf.xml` sets, on the inbound browser leg:
```xml
<action application="set" data="rtp_secure_media=${mrf_secure_media}"/>   <!-- = true -->
<action application="set" data="rtp_secure_media_inbound=true"/>
```
with `vars.xml`: `mrf_secure_media=true`.

`rtp_secure_media[_inbound]=true` force **SDES-SRTP** (the `a=crypto` mechanism).
A WebRTC browser offers **DTLS-SRTP** (`m=audio … UDP/TLS/RTP/SAVPF` + `a=fingerprint`,
**no** `a=crypto`). FreeSWITCH therefore marks the leg secure-required, finds no
crypto suite to negotiate, and logs *"Crypto not negotiated but required."*

The in-file comment claiming `rtp_secure_media_inbound=true` "pins the leg to
DTLS-SRTP" is incorrect — that variable selects SDES, not DTLS. DTLS is
auto-detected from the fingerprint and does **not** need `rtp_secure_media`.

## Ruled Out
- **DTLS cert** — `tls/dtls-srtp.pem` is valid: key/cert pair matches, not expired,
  present inside the container. Same cert works locally.
- **`ext-rtp-ip`** — already corrected; `Ext-RTP-IP 77.237.241.24` verified live.
- **Profile `rtp-secure-media`** — already `optional`; not the forcing factor
  (the dialplan channel vars override it to `true`).
- **Profile drift local vs prod** — the two `drachtio_mrf.xml` profiles are
  functionally identical for crypto.

Local "works" only because the WebRTC `connectCaller` path (voicemail/IVR) was
never actually exercised there; the bug is in shared config, not prod-specific.

## Proposed Fix
Stop forcing SDES on the WebRTC browser leg so FreeSWITCH uses DTLS from the
fingerprint:
- Relax `mrf_secure_media` from `true` → `optional` in `vars.xml`, **or**
- Remove `rtp_secure_media` / `rtp_secure_media_inbound` from the browser-leg
  block in `dialplan/mrf.xml` (let DTLS auto-negotiate), keeping the
  trunk/Teams-leg SRTP policy separate.

## Verification (before/after)
Capture one offline call:
```bash
docker exec drachtio-freeswitch fs_cli -p 'JambonzR0ck$' -x "sofia profile drachtio_mrf siptrace on"
docker exec drachtio-freeswitch fs_cli -p 'JambonzR0ck$' -x "console loglevel debug"
docker logs -f --since 1s drachtio-freeswitch 2>&1 | tee /tmp/fs-dtls.log
grep -iE "a=fingerprint|a=crypto|RTP/SAVPF|Crypto not negotiated" /tmp/fs-dtls.log
```
- Offer should show `UDP/TLS/RTP/SAVPF` + `a=fingerprint`, **no** `a=crypto` → confirms DTLS.

## Affected Files
- `docker/freeswitch_configs/vars.xml` (`mrf_secure_media`)
- `docker/freeswitch_configs/dialplan/mrf.xml` (browser-leg secure-media sets)

## Acceptance Criteria
- [ ] WebRTC call into the MRF completes media (DTLS-SRTP) with no
      "Crypto not negotiated but required" warning.
- [ ] Audio flows both ways; call holds past the ~3.5s drop.
- [ ] `FAILED-CALLS-IN` stops climbing on the `drachtio_mrf` profile.
- [ ] Softphone/trunk (non-WebRTC) legs still negotiate per their own policy.
