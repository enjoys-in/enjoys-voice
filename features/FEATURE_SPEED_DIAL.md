# Speed Dial / Favorites

> **Goal:** mark contacts as favorites for quick access and assign speed-dial keys
> (long-press 2 = call Mom). Favorites are shown prominently on the home screen
> and dial pad.
>
> **What already exists to build on:**
>   - Contact CRUD: Go API `contacts` table + `contact_handler.go` +
>     `ContactsScreen.tsx` + `contact.store.ts`.
>   - Dial pad: `KeypadScreen.tsx` with DTMF buttons 0–9, *, #.
>   - Call function: `onCall(target, name?)` passed to all screens.

## Data Model

- [ ] Extend `Contact` model in Go (`server/internal/models/contact.go`):
      ```go
      Favorite    bool `gorm:"column:favorite;default:false"`
      SpeedDial   *int `gorm:"column:speed_dial"` // 2–9 (1 = voicemail convention)
      ```
      AutoMigrate. Unique constraint: `(owner_extension, speed_dial)` — one
      contact per key per user.
- [ ] Extend the frontend `Contact` type to include `favorite: boolean` and
      `speedDial?: number`.

## Go API Changes

- [ ] Extend `PUT /api/g/contacts/:id` to accept `favorite` and `speedDial`
      fields.
- [ ] `POST /api/g/contacts/:id/favorite` — toggle favorite (convenience).
- [ ] Validation: `speedDial` must be 2–9 or null. If the key is already assigned
      to another contact, return `409 Conflict` with a message.
- [ ] `GET /api/g/contacts?favorites=true` — filter to favorites only.
- [ ] `GET /api/g/contacts/speed-dial` — return the speed-dial map
      `{ [key: number]: Contact }` for rendering the dial pad overlay.

## Frontend — Favorites

- [ ] **ContactsScreen.tsx**: add a star icon button on each contact row. Filled
      star = favorite, outline star = not favorite. Tap to toggle via
      `goApi.contacts.toggleFavorite(id)`.
- [ ] **Favorites section**: show a pinned "Favorites" group at the top of the
      contacts list (above the alphabetical list). Or a separate "Favorites" tab.
- [ ] **Home screen / Dial pad**: show a horizontal scrollable row of favorite
      avatars at the top of the `KeypadScreen` — tap to call immediately.
      3–6 circular avatars with names below.

## Frontend — Speed Dial

- [ ] **KeypadScreen.tsx**: when the user **long-presses** a digit key (2–9),
      initiate a call to the assigned speed-dial contact. Visual: show a small
      contact avatar/name label in the corner of the key if assigned.
- [ ] **Speed dial assignment**: in the contact edit dialog, add a "Speed dial"
      dropdown (2–9 or "None"). Show which contacts already have keys assigned.
      Or: long-press a digit on the keypad → picker to assign a contact to that
      key.
- [ ] `contact.store.ts`: add `speedDialMap` computed from the contacts list.
      `getSpeedDial(key: number): Contact | undefined`.
- [ ] **Keypad overlay**: when a digit is long-pressed and has a speed-dial
      contact, show a brief toast "Calling Mom…" before initiating the call.

## Config

- [ ] No env vars needed — this is purely a UI + data feature.
- [ ] Speed dial key 1 is conventionally voicemail (like cell phones). Reserve it
      or make it configurable.

## Guardrails / Edge Cases

- [ ] **No contact assigned**: long-pressing a digit with no speed-dial does
      nothing (or shows a prompt to assign one).
- [ ] **Contact deleted**: if a favorited/speed-dial contact is deleted, the
      fields are cleaned up automatically (cascading or the delete handler clears
      them).
- [ ] **Mobile sync**: the Flutter app should show the same favorites and
      speed-dial assignments (they're server-side via the Go API).
- [ ] **Accessibility**: the long-press interaction should have an alternative
      (e.g., a dedicated speed-dial settings page) for users who find long-press
      difficult.
