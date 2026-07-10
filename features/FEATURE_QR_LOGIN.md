# QR Code Login for Mobile

> **Goal:** scan a QR code on the web app to instantly log in on the mobile app,
> instead of typing extension + password on a small keyboard.
>
> **What already exists to build on:**
>   - JWT auth: Go API issues access + refresh token pairs. `POST /api/g/auth`
>     (login), `POST /api/g/auth/refresh` (refresh). The mobile app uses the
>     same endpoints.
>   - WebSocket signalling: `signaling.server.ts` — real-time channel between
>     web and server.
>   - Mobile app: Flutter, logs in via Go API, stores JWT in secure storage.

## Flow

```
  Web Browser                   Server (Go API)                   Mobile App
      │                              │                                │
      │  1. GET /api/g/auth/qr       │                                │
      │  ─────────────────────────►  │                                │
      │                              │  Generate a random `qrToken`    │
      │                              │  (UUID, 120s TTL, stored in     │
      │                              │   Valkey: qr:<token> → pending) │
      │  ◄─────────────────────────  │                                │
      │  { qrToken, expiresAt }      │                                │
      │                              │                                │
      │  2. Render QR code            │                                │
      │  (encodes: { token, apiBase })│                                │
      │                              │                                │
      │  3. Poll: GET /api/g/auth/qr/status?token=<qrToken>           │
      │  ─────────────────────────►  │                                │
      │  { status: 'pending' }       │                                │
      │                              │                                │
      │                              │  4. Mobile scans QR             │
      │                              │  ◄────────────────────────────  │
      │                              │  POST /api/g/auth/qr/confirm   │
      │                              │  { qrToken, extension, password │
      │                              │    OR refreshToken }            │
      │                              │                                │
      │                              │  5. Verify credentials +        │
      │                              │     generate JWT pair for mobile │
      │                              │     + mark qrToken as confirmed │
      │                              │     with the mobile's JWT        │
      │                              │  ────────────────────────────►  │
      │                              │  { accessToken, refreshToken,   │
      │                              │    user, sipConfig }            │
      │                              │                                │
      │  6. Poll returns 'confirmed'  │                                │
      │  ◄─────────────────────────  │                                │
      │  (web shows "Mobile logged    │                                │
      │   in successfully!")          │                                │
```

**Alternative to polling**: use the WebSocket channel. After step 2, the web
client listens on WS for a `qr_confirmed` event tied to the `qrToken`. The
server pushes it on step 5. No polling needed.

## Go API Endpoints

- [ ] `GET /api/g/auth/qr` — generate a QR login token.
      - Generate a UUID `qrToken`.
      - Store in Valkey: key `qr:<token>`, value `{"status":"pending"}`,
        TTL 120 seconds.
      - Response: `{ qrToken, expiresAt }`.
      - No auth required (the web user hasn't logged in on mobile yet — but the
        web IS authenticated, so this is scoped to the logged-in web user).
      - Actually: this can be unauthenticated (the QR is just a capability to
        initiate a login). The mobile confirms with real credentials.

- [ ] `POST /api/g/auth/qr/confirm` — mobile confirms the QR login.
      - Body: `{ qrToken, extension, password }` OR `{ qrToken, refreshToken }`.
      - Verify the `qrToken` exists in Valkey and is `pending`.
      - Verify the credentials (same logic as `/api/g/auth`).
      - Generate a new JWT pair for the mobile session.
      - Update Valkey: `qr:<token>` → `{"status":"confirmed"}`.
      - Response (to mobile): `{ accessToken, refreshToken, user, sipConfig }`.
      - Delete the Valkey key (one-time use).

- [ ] `GET /api/g/auth/qr/status?token=<qrToken>` — web polls for confirmation.
      - Read Valkey `qr:<token>`.
      - Response: `{ status: 'pending' | 'confirmed' | 'expired' }`.
      - If `confirmed`, the web can show a success message.
      - If the key doesn't exist, return `{ status: 'expired' }`.

## Frontend (Web — QR display)

- [ ] **LoginScreen.tsx** or **SettingsScreen.tsx**: add a "Log in on mobile" button.
      Clicking it calls `GET /api/g/auth/qr`, then renders the QR code.
- [ ] QR code library: use `qrcode.react` (`bun add qrcode.react`) to render the
      QR in the browser.
- [ ] QR payload: `JSON.stringify({ token: qrToken, apiBase: 'https://...:3003' })`.
      The mobile app needs the API base URL to know where to confirm.
- [ ] Show a countdown timer (120s) and a "Regenerate" button when expired.
- [ ] Poll `/api/g/auth/qr/status` every 2 seconds (or listen via WS). On
      `confirmed` → show a green checkmark "Mobile logged in!".

## Frontend (Mobile — QR scan)

- [ ] Add a "Scan QR code" button on the Flutter login screen.
- [ ] Use a QR scanner package (`mobile_scanner` or `qr_code_scanner`).
- [ ] On scan: decode the JSON payload → extract `token` and `apiBase`.
- [ ] Call `POST <apiBase>/api/g/auth/qr/confirm` with the user's existing
      credentials (if already logged in on mobile, use the refresh token) or
      prompt for extension + password.
- [ ] On success: store the JWT pair, navigate to the home screen.
- [ ] **Alternative**: if the user is already logged in on the WEB and wants to
      transfer the session to mobile, the web can include the refresh token in
      the QR payload (encrypted). The mobile just exchanges it. Simpler but less
      secure (the QR contains a credential).

## Guardrails / Edge Cases

- [ ] **One-time use**: the `qrToken` is deleted from Valkey after confirmation.
      Scanning the same QR again returns `expired`.
- [ ] **Short TTL**: 120 seconds. After that the QR is invalid. Prevents stale
      QR codes from being reused.
- [ ] **Rate limiting**: limit QR generation to 5/min per IP to prevent abuse.
- [ ] **Security**: the QR itself is NOT a credential — it's just a session
      initiation token. The mobile still needs to provide real credentials
      (password or refresh token) to confirm. The server verifies them normally.
- [ ] **HTTPS only**: the QR payload includes the `apiBase` URL. In production
      this must be HTTPS. The mobile app should refuse HTTP `apiBase` values.
- [ ] **No credential in QR**: never encode passwords, JWT tokens, or secrets in
      the QR code itself. The QR is just a rendezvous point.
