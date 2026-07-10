# Custom Ringtones per Contact

> **Goal:** assign different ringtones to specific contacts so you know who's
> calling by the sound. Unknown / PSTN callers can have a distinct ringtone too.
>
> **What already exists to build on:**
>   - Sound upload: Go API `POST /api/g/sounds/upload` + `GET /api/g/sounds/:ext`
>     for `caller_tune` and `ringtone` types. Sounds are stored as files and
>     served via HTTP.
>   - Per-user ringtone: `user_settings.ringtone` — a single ringtone for all
>     calls. `SettingsScreen.tsx` has the upload + select UI.
>   - Contact model: `contacts` table with `owner_extension`, `name`, `extension`.
>   - Incoming call UI: `useSipPhone.ts` `onInvite` → `AppShell.tsx` shows the
>     incoming-call overlay. The ringtone is played via Web Audio.
>   - WS `incoming_call` event: carries `from`, `fromName`, `callId`.

## Data Model

- [ ] Extend `Contact` model in Go: add `RingtoneId *uint
      gorm:"column:ringtone_id"` — FK to the `sounds` table. Nullable (null =
      use the default user ringtone).
- [ ] Extend `UserSettings` in Go: add `UnknownCallerRingtoneId *uint
      gorm:"column:unknown_ringtone_id"` — a separate ringtone for callers not
      in the contact list. Nullable (null = use the default ringtone).
- [ ] Frontend types: `Contact.ringtoneId?: number`, `Contact.ringtoneUrl?: string`.

## Go API Changes

- [ ] Extend `PUT /api/g/contacts/:id` to accept `ringtoneId` (FK to a sound the
      user owns). Validate that the sound exists and belongs to the user.
- [ ] Extend the contact list/detail response to include `ringtoneUrl` (resolved
      from the `sounds` table join).
- [ ] Extend settings to accept `unknownCallerRingtoneId`.

## Frontend — Ringtone Assignment

- [ ] **Contact edit dialog** (`ContactsScreen.tsx`): add a "Ringtone" picker.
      Options: "Default" + a list of the user's uploaded sounds (fetched from
      `goApi.getSounds(ext)`). A small play-preview button next to each option.
- [ ] **SettingsScreen.tsx**: add an "Unknown caller ringtone" picker below the
      existing "Ringtone" setting. Same sound list.

## Frontend — Ringtone Playback on Incoming Call

- [ ] In `useSipPhone.ts` or `AppShell.tsx`, when an incoming call arrives:
      1. Resolve the caller's identity: extension or phone number.
      2. Check the contact store: does any contact match?
      3. If matched AND `contact.ringtoneUrl` is set → play that sound.
      4. Else if no match AND `settings.unknownCallerRingtoneUrl` is set →
         play the unknown-caller ringtone.
      5. Else → play the default user ringtone (existing behavior).
- [ ] The ringtone URL is already handled by the Web Audio playback code in the
      incoming-call handler — just swap the URL source.
- [ ] **Preload**: on login, preload all contact ringtone URLs (and the unknown-
      caller ringtone) into the browser's audio cache so there's no delay when a
      call arrives.

## Config

- [ ] No env vars needed — this is purely a data + UI feature.
- [ ] Sound types: reuse the existing `ringtone` sound type. No new upload
      category needed.

## Guardrails / Edge Cases

- [ ] **Sound deleted**: if a sound used as a contact ringtone is deleted, the FK
      becomes dangling. Handle gracefully: fall back to the default ringtone.
      Optionally set `ringtone_id = NULL` on sound delete (ON DELETE SET NULL).
- [ ] **File format**: uploaded ringtones should be short (< 30s, < 2MB). The
      existing sound upload already validates format. The browser audio playback
      should loop the sound until the call is answered or rejected.
- [ ] **Mobile app**: the Flutter app should fetch the contact's ringtone URL and
      play it for incoming calls. CallKit (iOS) supports custom ringtones via
      local files; Android `ConnectionService` can set a custom ringtone URI.
      This is a v2 concern — the mobile app uses the system ringtone by default.
- [ ] **Performance**: for a personal contact list (< 500), looking up the
      ringtone on each incoming call is instant (in-memory contact store).
