# Enjoys Voice - Roadmap & TODO

## Audit Log Service
- [ ] Create `src/services/audit.service.ts`
- [ ] Log events: register, unregister, call_start, call_answered, call_declined, call_ended, call_failed
- [ ] Each entry: `{ id, timestamp, userId, extension, event, metadata, ip }`
- [ ] In-memory store for dev, persist to SQLite/Postgres for prod (same adapter pattern as registration store)
- [ ] Expose via HTTP API: `GET /api/audit?user=1001&from=&to=&event=`
- [ ] Add to WebSocket admin panel for real-time audit feed

## SIP URI Domain
- [ ] Replace `.invalid` contact domain with `config.server.domain` (e.g., `enjoys.in`)
- [ ] Client SIP.js URI: `sip:{extension}@{DOMAIN}` read from env `SIP_DOMAIN`
- [ ] Server side: accept registrations for `@enjoys.in` domain
- [ ] From/To headers use `sip:1001@enjoys.in` format

## User Signup via Mobile
- [ ] Add `POST /api/signup` — accepts `{ countryCode, mobile, name }`
- [ ] Generate extension automatically (e.g., mobile number or sequential)
- [ ] OTP verification via SMS gateway (Twilio/MSG91/custom)
- [ ] On signup: create SIP user, assign extension, store in DB
- [ ] Login via mobile + OTP (no password needed for end users)

## Call Routing: SIP → PSTN Fallback
- [ ] On INVITE: check if callee is registered (SIP-to-SIP)
- [ ] If offline: route via PSTN trunk to their mobile number
- [ ] Trunk config per user: `{ mobile, countryCode, preferSip: true }`
- [ ] Fallback chain: SIP → PSTN → Voicemail
- [ ] Support calling external mobile numbers directly (with country code dial plan)

## Dial Plan
- [ ] Internal: 7-digit extensions (1001-9999)
- [ ] External: `+{countryCode}{number}` → route via trunk
- [ ] IVR: 5000, 1800*, 800* → IVR system
- [ ] Emergency: configurable per-region

## Production Concerns
- [ ] Registration store → Redis/Valkey (done, adapter exists)
- [ ] Audit store → PostgreSQL
- [ ] User store → PostgreSQL with migrations
- [ ] Rate limiting on register/invite
- [ ] TLS for SIP (port 5061)
- [ ] SRTP for media encryption
- [ ] Horizontal scaling: multiple drachtio instances behind load balancer

## Go Voice Core (sipgo)

 
- [ ] Trunk model: `{ id, name, host, port, transport, username, password, callerNumber, prefix, codecs, enabled }`
- [ ] REST API endpoints:
  - `GET /api/trunks` — list all trunks
  - `POST /api/trunks` — create trunk
  - `GET /api/trunks/:id` — get trunk details
  - `PUT /api/trunks/:id` — update trunk
  - `DELETE /api/trunks/:id` — delete trunk
  - `POST /api/trunks/:id/test` — test trunk connectivity (OPTIONS ping)
- [ ] Trunk registration: periodic REGISTER to upstream providers
- [ ] Outbound routing: Go handles PSTN/external calls via configured trunks
- [ ] Inbound routing: receive calls from trunks, forward to Node SIP server
- [ ] Health checks: monitor trunk status (registered/failed/retrying)
- [ ] Database: PostgreSQL for trunk persistence
- [ ] Config hot-reload: update trunk config without restart
- [ ] Integrate with Node server: Go handles trunks, Node handles WebRTC/WS clients
