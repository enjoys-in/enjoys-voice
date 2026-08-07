# Missed Call & Voicemail Notifications

> **Goal:** never miss an important call. When you're offline or the browser tab
> is in the background, get notified about missed calls and new voicemails via
> **mobile push** (FCM), **email**, and **browser web push** (PWA Notification
> API). Each channel is independent and opt-in.
>
> **What already exists to build on:**
>   - `PushService` (`src/services/push.service.ts`) — already sends FCM
>     `incoming_call` pushes to the Flutter app. Adding `missed_call` and
>     `new_voicemail` types is the same code path.
>   - `sendConnectorEmail` (`src/services/mailer.ts`) — sends emails via SMTP
>     through IVR connectors. Can be reused for notification emails with a
>     dedicated SMTP config (not per-connector).
>   - WebSocket signalling (`src/websocket/signaling.server.ts`) — already
>     broadcasts call events. Browser push is triggered when the WS is
>     disconnected (user offline).
>   - Call lifecycle: `sip.server.ts` logs `missed` / `declined` / `no_answer`
>     statuses. Voicemail save: `IvrSystem.recordVoicemail()` + `db.addVoicemail()`.
>   - Audit service (`src/services/audit.service.ts`) — logs lifecycle events;
>     notifications hook into the same terminal events.
>   - User settings: `user_settings` table (Go) + `SipUser` in-memory (Node) —
>     notification preferences can live here.

## Notification Events

| Event | When it fires | Payload |
|-------|--------------|---------|
| `missed_call` | A call to the user ends with `status = missed` (declined, no-answer, unreachable) | `{ from, fromName, timestamp, callId }` |
| `new_voicemail` | A voicemail is saved for the user (`db.addVoicemail`) | `{ from, fromName, duration, transcript?, timestamp, voicemailId }` |

## Data Model (Go — notification preferences)

- [ ] Extend `UserSettings` (`server/internal/models/settings.go`):
      ```
      NotifyMissedPush   bool `gorm:"column:notify_missed_push;default:true"`
      NotifyMissedEmail  bool `gorm:"column:notify_missed_email;default:false"`
      NotifyVoicemailPush  bool `gorm:"column:notify_vm_push;default:true"`
      NotifyVoicemailEmail bool `gorm:"column:notify_vm_email;default:true"`
      NotificationEmail  string `gorm:"column:notification_email;size:255"`
      ```
      AutoMigrate adds the columns. Mirror into `SettingsResponse` /
      `SettingsInput`. Node picks them up via the existing LISTEN/NOTIFY
      settings sync.
- [ ] Add the fields to `SipUser` in Node (`src/core/types.ts`) and hydrate them
      in `loadPstnByExtension` / `hydrateUserDetail` (same pattern as `dnd`,
      `ratePlanId`).

## Channel 1: Mobile Push (FCM) — Missed Call + Voicemail

- [ ] Extend `PushService` with two new methods:
      - `sendMissedCall(extension, { from, fromName, callId, timestamp })` — FCM
        data message `{ type: 'missed_call', ... }`. Normal priority (not a ring).
      - `sendNewVoicemail(extension, { from, fromName, duration, transcript?,
        voicemailId })` — FCM data message `{ type: 'new_voicemail', ... }`.
        Include the transcript in the body if available.
- [ ] Both methods check `user.notifyMissedPush` / `user.notifyVoicemailPush`
      before sending (respect user preferences).
- [ ] **Hook points**:
      - Missed call: in `sip.server.ts` where `updateCall(callId, { status: 'missed' })`
        is called — after the update, fire `push.sendMissedCall(calleeExt, ...)`.
        Guard: only when the callee is the local user and they were offline or
        didn't answer.
      - New voicemail: in `IvrSystem.recordVoicemail()` after `db.addVoicemail(vm)`,
        fire `push.sendNewVoicemail(vm.mailbox, ...)`.
- [ ] Flutter app: handle the new message types in the FCM message handler —
      show a local notification (not a full-screen incoming-call UI).

## Channel 2: Email

- [ ] New `NotificationMailer` (`src/services/notification-mailer.ts`):
      - Configured via env: `NOTIFICATION_SMTP_HOST`, `NOTIFICATION_SMTP_PORT`,
        `NOTIFICATION_SMTP_USER`, `NOTIFICATION_SMTP_PASS`,
        `NOTIFICATION_FROM_EMAIL`, `NOTIFICATION_FROM_NAME`.
      - Or reuse an existing email connector if configured.
      - `sendMissedCallEmail(toEmail, { from, fromName, timestamp })` — subject:
        "Missed call from {fromName}", body: plain text with call details.
      - `sendVoicemailEmail(toEmail, { from, fromName, duration, transcript? })` —
        subject: "New voicemail from {fromName}", body: transcript if available,
        plus a link to the web UI to listen.
- [ ] Hook points: same as push, but check `user.notifyMissedEmail` /
      `user.notifyVoicemailEmail` and `user.notificationEmail` (must be non-empty).
- [ ] **Never blocking**: email sends are fire-and-forget (`catch` and log).
      A failed email must never delay call teardown.

## Channel 3: Browser Web Push (PWA Notification API)

- [ ] **Service worker**: the Next.js PWA should register a service worker that
      can receive push messages even when the tab is closed. Use the **Web Push
      API** (VAPID keys).
- [ ] New env vars: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`
      (email:your@email). Generate once with `web-push generate-vapid-keys`.
- [ ] **Subscribe flow**: on login, the web client requests notification
      permission → `pushManager.subscribe()` → sends the subscription (endpoint +
      keys) to `POST /api/n/push/web-subscribe` (new endpoint). Node stores it
      per-extension (in-memory or Postgres).
- [ ] **Send flow**: `WebPushService.send(extension, { title, body, icon, data })`
      — uses the `web-push` npm package to POST to the browser's push endpoint.
- [ ] Hook points: same as FCM push, but uses the web push subscription.
      Only fire when the user's WebSocket is **disconnected** (they're not
      actively on the page — no point pushing if they'll see the WS event).
- [ ] Service worker `push` event: show a `Notification` with the title/body.
      `notificationclick`: open / focus the app.

## Frontend (settings + display)

- [ ] `SettingsScreen.tsx` — new **Notifications** section:
      - Toggle: "Push notifications for missed calls" (on/off)
      - Toggle: "Push notifications for voicemails" (on/off)
      - Toggle: "Email notifications for missed calls" (on/off)
      - Toggle: "Email notifications for voicemails" (on/off)
      - Input: "Notification email address"
      - Button: "Enable browser notifications" → triggers the permission request
        and web push subscription.
- [ ] Update `go-api.ts` and `settings.store.ts` with the new fields.
- [ ] **In-app toast**: when a `missed_call` or `new_voicemail` WS event arrives
      while the app is open, show a toast notification (reuse the existing call
      event toast pattern). The push channels are only for when you're NOT
      looking at the app.
- [ ] **Badge count**: show an unread badge on the Recents / Voicemail nav icons
      when there are unacknowledged missed calls or unread voicemails.

## Config

- [ ] Env vars summary:
      - `NOTIFICATION_SMTP_HOST`, `NOTIFICATION_SMTP_PORT`, `NOTIFICATION_SMTP_USER`,
        `NOTIFICATION_SMTP_PASS`, `NOTIFICATION_FROM_EMAIL`, `NOTIFICATION_FROM_NAME`
        — optional; email notifications are disabled when host is empty.
      - `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` — optional; web
        push is disabled when keys are empty.
      - Push (FCM) config reuses the existing `PUSH_ENABLED` + `FCM_SERVER_KEY`.

## Guardrails / Edge Cases

- [ ] **Deduplication**: don't send multiple notifications for the same call. The
      `missed` status is set once (guard with a `notified` flag on the in-memory
      call or a Set of notified call IDs with TTL).
- [ ] **Flood protection**: if 10 calls come in rapid succession (robocalls),
      batch or throttle notifications. E.g., after 3 missed-call notifications
      in 60 seconds, suppress and send a summary ("You missed 7 calls").
- [ ] **DND awareness**: when the user has DND enabled, they intentionally
      silenced calls. Still send voicemail notifications (they want the message),
      but skip missed-call notifications (they know they're silencing calls).
- [ ] **Time zone**: email/push bodies should display times in the user's
      configured timezone (from `user_availability_windows.timezone` or a new
      `UserSettings.timezone` column).
- [ ] **Unsubscribe**: web push subscriptions can expire or be revoked by the
      browser. Handle `410 Gone` from the push endpoint by removing the stale
      subscription. Same for FCM: handle `NotRegistered` errors.
