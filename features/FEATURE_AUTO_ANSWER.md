# Auto-Answer Mode

> **Goal:** a toggle that automatically answers incoming calls after a configurable
> delay (like a desk phone on speaker). Useful for hands-free / car mode, or when
> you're expecting a specific call and your hands are busy.
>
> **What already exists to build on:**
>   - Incoming call handler: `useSipPhone.ts` `onInvite` delegate → shows the
>     incoming-call overlay with Accept / Reject buttons.
>   - `answerCall()` in `useSipPhone.ts` — accepts the SIP session.
>   - User settings: `user_settings` (Go) + `settings.store.ts` (frontend).
>   - DND: already a per-user toggle that silences calls. Auto-answer is the
>     opposite — pick up immediately.

## Data Model

- [ ] Extend `UserSettings` in Go:
      ```go
      AutoAnswer      bool `gorm:"column:auto_answer;default:false"`
      AutoAnswerDelay int  `gorm:"column:auto_answer_delay;default:3"` // seconds
      ```
      AutoMigrate. Mirror to `SettingsResponse` / `SettingsInput`.
- [ ] Frontend settings type: add `autoAnswer: boolean`, `autoAnswerDelay: number`.

## Frontend Implementation

- [ ] In the incoming-call handler (`AppShell.tsx` or `useSipPhone.ts`):
      ```ts
      // When an incoming call is received:
      if (settings.autoAnswer && !settings.dnd) {
        autoAnswerTimerRef.current = setTimeout(() => {
          answerCall();
        }, (settings.autoAnswerDelay ?? 3) * 1000);
      }
      // Clear the timer if the user manually answers/rejects or caller hangs up.
      ```
- [ ] Show a countdown badge on the incoming-call overlay: "Auto-answering in
      3... 2... 1..." so the user can cancel by tapping Reject.
- [ ] If the user taps Accept before the timer → accept immediately, clear timer.
- [ ] If the user taps Reject → reject, clear timer.
- [ ] If the caller hangs up → clear timer.

## Settings UI

- [ ] `SettingsScreen.tsx` — new "Auto-Answer" section:
      - Toggle: "Auto-answer incoming calls" (on/off)
      - Slider or dropdown: "Delay before answering" — 1 / 2 / 3 / 5 / 10 seconds
      - Info text: "When enabled, incoming calls are automatically answered after
        the selected delay. You can still reject during the countdown."
      - Warning: "Auto-answer is disabled when Do Not Disturb is on."

## Guardrails / Edge Cases

- [ ] **DND takes precedence**: if DND is on, auto-answer is ignored (calls go
      to voicemail). Check `!settings.dnd` before arming the timer.
- [ ] **Multiple simultaneous calls**: if a second call comes in while on a call,
      don't auto-answer (would interrupt the current call). Guard with
      `callState !== 'active'`.
- [ ] **Widget calls**: auto-answer should work for all call types (internal,
      external, widget) — it's a callee-side behavior.
- [ ] **Privacy risk**: auto-answering opens the microphone. The countdown UI
      must be visible so the user knows they're about to go live. Consider a
      short beep on auto-answer to audibly signal the connection.
- [ ] **Mobile app**: the Flutter app can implement the same logic — read the
      setting from the Go API, arm a timer on incoming call intent. CallKit /
      ConnectionService may need special handling for auto-answer.
- [ ] **Server-side alternative**: instead of client-side auto-answer, the SIP
      server could auto-accept the B2BUA leg. But this is harder and less
      flexible — client-side is preferred.
