# CallNet - WebRTC Phone System

Real browser-based phone calls with microphone audio, SIP trunking, and Twilio integration.

## Architecture

```
┌─────────────────┐     WebSocket      ┌──────────────────┐
│   Browser (UI)  │◄──────────────────►│   API Server     │
│  Next.js + WebRTC│    Signaling       │  Express + WS    │
│  Real Mic Audio  │                    │  Port 3001/3002  │
└────────┬────────┘                    └───────┬──────────┘
         │                                      │
         │  WebRTC (P2P audio)                  │ SIP (drachtio)
         │                                      │
         ▼                                      ▼
   ┌───────────┐                         ┌────────────┐
   │ STUN/TURN │                         │  Twilio    │
   │  Google   │                         │  SIP Trunk │
   └───────────┘                         └────────────┘
```

## Modes

### Online Mode (Twilio)
- External PSTN calls via Twilio Elastic SIP Trunk
- Use your Twilio number to call any phone worldwide
- Set `TWILIO_ENABLED=true` in `.env`

### Offline Mode (Default)
- Internal calls between registered users via WebRTC P2P
- No external dependency needed
- Works on localhost for testing

## Quick Start

### 1. Start API Server
```bash
cd api
cp .env.example .env    # edit with your settings
bun install
bun run dev
```

### 2. Start Web UI
```bash
cd api/web
npm install
npm run dev
```

### 3. Test Calling
1. Open http://localhost:3000
2. Login as `user1` / `pass123`
3. Open a 2nd browser tab, login as `user2` / `pass123`
4. In the Contacts tab, click the call button next to the other user
5. Accept the incoming call in the other tab
6. Both tabs now have a live audio call using your real microphone

## Default Users

| Extension | Username | Password | Name    |
|-----------|----------|----------|---------|
| 1001      | user1    | pass123  | Alice   |
| 1002      | user2    | pass123  | Bob     |
| 1003      | user3    | pass123  | Charlie |

## API Endpoints

| Method | Path          | Description                  |
|--------|---------------|------------------------------|
| GET    | /api/health   | Server status                |
| GET    | /api/users    | List SIP users               |
| POST   | /api/users    | Create SIP user              |
| POST   | /api/auth     | Login and get SIP config     |
| GET    | /api/calls    | Call history                 |
| POST   | /api/call     | Initiate outbound call       |
| GET    | /api/trunk    | Trunk configuration          |

## Twilio Setup

1. Create a Twilio account at https://console.twilio.com
2. Buy a phone number
3. Go to Elastic SIP Trunking -> Create trunk
4. Under Origination, add your server's public IP on port 5060
5. Under Termination, set up credentials
6. Fill in `.env`:
   ```
   TWILIO_ENABLED=true
   TWILIO_ACCOUNT_SID=ACxxxxx
   TWILIO_AUTH_TOKEN=xxxxx
   TWILIO_SIP_DOMAIN=yourapp.pstn.twilio.com
   TWILIO_CALLER_NUMBER=+15551234567
   TWILIO_TRUNK_SIP_URI=yourtrunk.pstn.twilio.com
   ```

## Docker (Full SIP Stack)

For production with full SIP infrastructure:
```bash
cd api/docker
docker compose up -d
```

This starts drachtio, FreeSWITCH, RTPEngine, and the app server.

## Features

- Real microphone audio via WebRTC
- DTMF dial pad with tone generation
- Call timer and audio level visualizer
- Mute/unmute controls
- Incoming call notification with accept/reject
- Online user presence
- Call history log
- Twilio SIP trunk for PSTN calls
- Offline mode for internal-only calling
- User authentication
- REST API for programmatic call control

## Reference Links
- https://hub.docker.com/r/safarov/freeswitch/
- https://hub.docker.com/r/mlan/asterisk
- https://github.com/drachtio/docker-drachtio-freeswitch-mrf
- https://github.com/PatrickBaus/freeswitch-docker