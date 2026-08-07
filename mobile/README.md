# Enjoys Voice — Mobile Softphone (Flutter)

A native iOS + Android softphone for the CallNet / Enjoys Voice platform. It logs
in against the same Go API as the web dialer, registers as a SIP-over-WebSocket
endpoint, makes and receives WebRTC calls, and **rings on the lock screen / in the
background** via CallKit (iOS) + ConnectionService (Android) woken by push.

> The backend is unchanged except for an opt-in push hook in the Node SIP engine
> (`PUSH_ENABLED`). With push disabled the app still works fully in the
> foreground.

---

## Quick start

```bash
cd mobile
flutter create --org com.enjoys --project-name enjoys_voice .
flutter pub get
# merge native_setup/* into the generated android/ios, add Firebase config, then:
flutter run --dart-define=GO_API_BASE=http://<LAN_IP>:3003 \
  --dart-define=NODE_API_BASE=http://<LAN_IP>:3001 \
  --dart-define=SIP_WS_URL_OVERRIDE=ws://<LAN_IP>:5065 \
  --dart-define=SIP_DOMAIN_OVERRIDE=<LAN_IP>
```

Replace `<LAN_IP>` with the IP your phone can reach the backend on (e.g.
`192.168.1.48`). See [First-time setup](#first-time-setup) and
[Run (development)](#run-development) below for the details each step expands to.

---

## How it talks to the backend

Everything is discovered at login — the app only needs the Go API base URL.

| Concern            | Endpoint / value                                                            |
| ------------------ | --------------------------------------------------------------------------- |
| Login              | `POST <GO_API_BASE>/api/g/auth` → `{ token, refreshToken, user, sipConfig }` |
| Token refresh      | `POST /api/g/auth/refresh`                                                    |
| Profile            | `GET /api/g/auth/me`                                                          |
| SIP transport      | `sipConfig.sipWsUrl` (drachtio SIP-over-WS, dev `ws://HOST:5065`)            |
| SIP AOR            | `sip:<extension>@<sipConfig.domain>`                                          |
| SIP auth user/pass | `extension` / `extension` (the password equals the extension)               |
| Outgoing call      | INVITE `sip:<number>@<sipConfig.domain>`                                      |
| Push register      | `POST <NODE_API_BASE>/api/n/push/register` (Bearer JWT)                      |

---

## Prerequisites

- **Flutter SDK** 3.22+ — https://docs.flutter.dev/get-started/install
  (this repo was authored without the SDK present; you must install it to build).
- **Android**: Android Studio + an SDK with API 34, a device/emulator on API 23+.
- **iOS**: macOS + Xcode 15+, CocoaPods, a real device for VoIP push testing
  (the simulator cannot receive PushKit pushes).
- A **Firebase** project (for background wake-up push).

---

## First-time setup

The `lib/`, `pubspec.yaml`, and `native_setup/` files are committed; the native
`android/` and `ios/` folders are **not** (they're generated). Run:

```bash
cd mobile

# 1. Generate the platform folders + fetch packages.
flutter create --org com.enjoys --project-name enjoys_voice .
flutter pub get
```

### 2. Apply the native config

Merge the snippets from `native_setup/` into the generated projects:

- **Android** — copy permissions from
  [`native_setup/AndroidManifest.additions.xml`](native_setup/AndroidManifest.additions.xml)
  into `android/app/src/main/AndroidManifest.xml`, and follow
  [`native_setup/android-build-notes.md`](native_setup/android-build-notes.md)
  (minSdk 23, Google services plugin).
- **iOS** — add the keys from
  [`native_setup/Info.plist.additions.xml`](native_setup/Info.plist.additions.xml)
  to `ios/Runner/Info.plist`, and replace `ios/Runner/AppDelegate.swift` with
  [`native_setup/ios-AppDelegate.swift`](native_setup/ios-AppDelegate.swift)
  (PushKit → CallKit bridge). Enable the **Push Notifications** and
  **Background Modes → Voice over IP / Audio / Remote notifications** capabilities
  in Xcode.

### 3. Firebase

```bash
# Easiest: FlutterFire CLI generates lib/firebase_options.dart for you.
dart pub global activate flutterfire_cli
flutterfire configure
```

Or manually:

- Android: place `google-services.json` at `android/app/google-services.json`.
- iOS: place `GoogleService-Info.plist` in `ios/Runner/` (add to the target).
- iOS VoIP: upload your **APNs Auth Key** to Firebase, and for true background
  ringing send an APNs VoIP (PushKit) push — see “Background calls” below.

---

## Run (development)

The backend advertises a `sipWsUrl`/`domain` from its own `PUBLIC_IP`. From a
phone, `localhost`/`127.0.0.1` is unreachable, so either set the backend's
`PUBLIC_IP` / `PUBLIC_SIP_WS_URL` to your machine's LAN IP, **or** override on the
client with `--dart-define`:

```bash
flutter run \
  --dart-define=GO_API_BASE=http://192.168.1.48:3003 \
  --dart-define=NODE_API_BASE=http://192.168.1.48:3001 \
  --dart-define=SIP_WS_URL_OVERRIDE=ws://192.168.1.48:5065 \
  --dart-define=SIP_DOMAIN_OVERRIDE=192.168.1.48
```

| dart-define          | Default                  | Notes                                   |
| -------------------- | ------------------------ | --------------------------------------- |
| `GO_API_BASE`        | `http://10.0.2.2:3003`   | Go REST API (auth). `10.0.2.2` = emu host |
| `NODE_API_BASE`      | `http://10.0.2.2:3001`   | Node engine API (push register)         |
| `SIP_WS_URL_OVERRIDE`| _(empty)_                | Force the SIP-WS host (dev)             |
| `SIP_DOMAIN_OVERRIDE`| _(empty)_                | Force the SIP realm (dev)               |
| `ICE_SERVERS`        | Google STUN + dev TURN   | JSON array of `{urls,username,credential}` |

Build release artifacts:

```bash
flutter build apk --release   # Android
flutter build ipa --release   # iOS (then distribute via Xcode/Transporter)
```

---

## Background incoming calls

```
Caller dials ext 1001
        │
        ▼
Node SIP engine (INVITE handler)
        │  callee 1001 not SIP-registered (app asleep)  &&  PUSH_ENABLED
        ▼
PushService.sendIncomingCall(1001)  ──FCM data / APNs VoIP──►  device
        │                                                         │
        │                                          background isolate / PushKit
        │                                                         ▼
        │                                        flutter_callkit_incoming shows
        │                                        the native incoming-call screen
        ▼                                                         │
INVITE keeps ringing over SIP                      user taps Accept → app wakes
        └──────────────────────────────────────────►  SIP registers, answers
```

Enable it on the **backend** (Node engine env):

```bash
PUSH_ENABLED=true
FCM_SERVER_KEY=<your Firebase Cloud Messaging server key>
# Optional: push on every inbound call, even when the device is registered.
# PUSH_ALWAYS=true
```

- **Android** uses a high-priority **FCM data message** — handled by the
  top-level `firebaseBackgroundHandler` in `lib/src/services/push_service.dart`,
  which shows CallKit straight from the push payload.
- **iOS** requires an **APNs VoIP (PushKit)** push — iOS suppresses background
  data wakeups. The device's VoIP token is registered with the backend as the
  `ios_voip` platform. A production APNs VoIP sender (token-based `.p8` auth) must
  deliver the `incoming_call` payload; the native bridge in
  `native_setup/ios-AppDelegate.swift` reports it to CallKit. (The bundled
  `PushService` sends FCM only; wire your APNs VoIP sender into
  `src/services/push.service.ts` for iOS.)

---

## Project layout

```
mobile/
├─ pubspec.yaml
├─ native_setup/            # snippets to merge after `flutter create .`
└─ lib/
   ├─ main.dart             # providers + auth-gated routing + call overlay
   └─ src/
      ├─ config/app_config.dart      # dart-define backed config
      ├─ models/                     # auth + call models
      ├─ services/
      │  ├─ api_client.dart          # envelope unwrap + Bearer + refresh
      │  ├─ auth_service.dart        # /api/g/auth/*
      │  ├─ token_store.dart         # secure JWT storage
      │  ├─ phone_service.dart       # sip_ua register / call / incoming
      │  ├─ callkit_service.dart     # native incoming-call UI bridge
      │  └─ push_service.dart        # FCM + VoIP token registration
      ├─ state/session_controller.dart  # auth + SIP + CallKit + push wiring
      └─ ui/                         # login / home (dialer) / call screens
```

---

## Security notes

- The JWT is stored in the OS keystore (`flutter_secure_storage`), never in
  plain prefs.
- Push tokens are bound to the **JWT's** extension server-side, so a device can
  only ever register a token for its own extension (no IDOR).
- For production, replace the dev TURN credentials via `--dart-define=ICE_SERVERS`
  and serve the backend over TLS (`wss://`) so SIP/WebRTC isn't sent in clear.

---

## Troubleshooting

- **Stuck on "Connecting"** — the SIP transport host is unreachable from the
  phone. Set `SIP_WS_URL_OVERRIDE` / the backend `PUBLIC_SIP_WS_URL` to a LAN IP.
- **`sip_ua` has no `iceServers` field** (older versions) — remove the
  `..iceServers = _iceServers()` line in `phone_service.dart`; LAN calls still
  work with host candidates + STUN.
- **No incoming ring in background** — confirm `PUSH_ENABLED=true` +
  `FCM_SERVER_KEY` on the backend, Firebase config files in place, and (iOS) the
  PushKit/VoIP capability + APNs VoIP sender.
- **No audio** — grant the microphone permission; on Android verify
  `RECORD_AUDIO` is in the merged manifest.
```
