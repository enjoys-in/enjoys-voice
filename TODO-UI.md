# UI Redesign — TODO

## Design System
- [x] Mobile-first layout (375px base, scales to tablet/desktop)
- [x] Dark theme SaaS design (glass morphism + gradients)
- [x] Reusable component library in `web/app/components/ui/`
- [x] Fully typed props with TypeScript interfaces
- [x] Responsive: mobile (375-768), tablet (768-1024), desktop (1024+)

## Navigation & Layout
- [x] Bottom tab bar (mobile): Calls, Contacts, Keypad, Settings
- [x] Sidebar (desktop): same tabs vertically + Sign Out
- [x] Header with user avatar + status indicator
- [x] App shell with SSR layout + client interactivity
- [x] Floating dial button (FAB) on non-keypad tabs
- [x] Screens stay mounted (no re-renders on tab switch)

## Screens

### 1. Auth (Login)
- [x] Login: extension + password
- [ ] ~~Signup~~ (removed from UI — backend only)
- [ ] OTP verification screen (future: connect to SMS gateway)
- [x] Sleek centered card design
- [x] Form validation (client-side zod with field-level errors)

### 2. Calls (Recent)
- [x] List of recent calls (from `/api/calls/:ext`)
- [x] Each row: avatar, name, direction icon (↗️ ↙️ ❌), time, duration
- [x] Tap to call back
- [x] Pull-to-refresh on mobile
- [x] Refresh button
- [x] Empty state illustration
- [x] 30s stale cache (no redundant API calls)

### 3. Contacts (Online Users)
- [x] List all users with online/offline status (green dot)
- [x] Search/filter bar
- [x] Tap to call
- [x] Long press → block (with confirmation dialog)
- [x] Show "online" users first, sorted
- [x] Add contact button + dialog (name + extension)
- [x] Edit contact (rename)
- [x] Delete contact (with confirmation)
- [x] Call/Edit/Delete action buttons per contact row

### 4. Keypad (Dial Pad)
- [x] Full T9 dial pad with sub-labels
- [x] Number display with backspace
- [x] Call button (green circle)
- [x] DTMF dual-tone audio on keypress (Web Audio API)
- [x] Keyboard/numpad input support (0-9, *, #, Backspace, Enter)
- [x] DTMF tones toggle in settings

### 5. Call Screen (Active Call)
- [x] Full-screen overlay
- [x] States: ringing, connected (timer), ended
- [x] Controls: mute, speaker, keypad, hang up
- [x] Caller tune plays during outbound ringing
- [x] Busy tone on decline

### 6. Incoming Call
- [x] Sheet overlay from top
- [x] Accept (green) / Decline (red) buttons
- [x] Caller name + extension

### 7. Settings
- [x] Profile section (name, extension, mobile)
- [x] **Audio & Sounds**
  - [x] Enable/disable sounds toggle
  - [x] Enable/disable DTMF keypad tones toggle
  - [x] Caller tune selector (dropdown + play preview 3s + upload custom)
  - [x] Ringtone selector (dropdown + play preview 3s + upload custom)
- [x] **Call Forwarding**
  - [x] On Busy → input extension
  - [x] On No Answer → input extension
  - [x] On Unavailable → input extension
  - [x] Syncs with API on change
- [x] **Block List**
  - [x] Show blocked numbers as badges
  - [x] Add number form
  - [x] Remove (click badge X)
  - [x] Syncs with API
- [x] **PSTN**
  - [x] Enable PSTN fallback toggle
  - [x] PhoneInput (country code selector + number)
- [x] **Recording**
  - [x] Enable call recording toggle
- [x] **Voicemail**
  - [x] Enable voicemail toggle
- [x] **Delete Account** (with confirmation dialog)
- [x] **Sign Out** (mobile only — desktop uses sidebar)

## Components Library (`web/app/components/ui/`)
- [x] `Avatar` (shadcn)
- [x] `Button` (shadcn) — all variants
- [x] `Input` (shadcn)
- [x] `Select` (shadcn)
- [x] `Switch` (shadcn)
- [x] `Badge` (shadcn)
- [x] `Card` (shadcn)
- [x] `Dialog` (shadcn)
- [x] `Sheet` (shadcn)
- [x] `ScrollArea` (shadcn)
- [x] `Separator` (shadcn)
- [x] `ListItem` — custom (leading/title/subtitle/trailing, onClick, onLongPress)
- [x] `EmptyState` — custom (icon + title + description)
- [x] `PhoneInput` — custom (country code Select + tel Input)

## Hooks
- [x] `useSipPhone` — SIP call management (register, makeCall, answer, hangUp, sendDtmf)
- [x] `useWebSocket` — WS connection (connect, disconnect, send, onMessage, presence updates)
- [x] `useCallHistory` — call logs from API (module-level cache, 30s stale)
- [x] `useSettingsSync` — settings load + save (module-level dedup, once per session)

## Stores (Zustand)
- [x] `useAuthStore` — user, token, sipConfig, login(), logout() (resets caches on logout)
- [x] `useCallStore` — activeCall, muted, speakerOn, tones
- [x] `useContactStore` — contacts, search, add/update/remove/filter
- [x] `useSettingsStore` — all settings, blocked numbers, forwarding

## Technical
- [x] Client components for interactive parts (SIP, WS)
- [x] Zod schemas for form validation
- [x] TypeScript strict mode
- [x] Tailwind responsive utilities
- [x] Zustand for global state
- [x] Typed API client (`web/app/lib/api.ts`)
- [x] PWA manifest (`web/public/manifest.json`)
- [x] Admin panel (`/admin` route) — health, users, calls, config tabs

## Audio & UX
- [x] Play dialing tone immediately when call initiated
- [x] Switch to caller tune (ringback) when ringing
- [x] Busy tone on decline
- [x] DTMF tones on keypad (toggleable)
- [x] Audio preview with 3s auto-stop in settings
- [x] Custom audio upload for caller tune and ringtone

---

## Backend Needed (UI is ready, backend support required)

### API Endpoints the UI expects (via `web/app/lib/api.ts`):

| Endpoint | Method | UI Status | Backend Status |
|----------|--------|-----------|----------------|
| `/api/auth/login` | POST | ✅ Used | ✅ Exists |
| `/api/auth/signup` | POST | ✅ Typed | ✅ Exists (no UI) |
| `/api/lookup/:phone` | GET | ✅ Typed | ✅ Exists |
| `/api/health` | GET | ✅ Used (admin) | ✅ Exists |
| `/api/users` | GET | ✅ Used (admin) | ✅ Exists |
| `/api/calls` | GET | ✅ Used (admin) | ✅ Exists |
| `/api/calls/:ext` | GET | ✅ Used | ✅ Exists |
| `/api/block/:ext` | GET | ✅ Used | ✅ Exists |
| `/api/block/:ext` | POST | ✅ Used | ✅ Exists |
| `/api/block/:ext/:number` | DELETE | ✅ Used | ✅ Exists |
| `/api/forwarding/:ext` | GET | ✅ Used | ✅ Exists |
| `/api/forwarding/:ext` | POST | ✅ Used | ✅ Exists |
| `/api/config` | GET | ✅ Used (admin) | ✅ Exists |
| `/api/trunk` | GET | ✅ Used (admin) | ✅ Exists |
| `/api/ivr/status` | GET | ✅ Typed | ✅ Exists |
| **`DELETE /api/users/:ext`** | DELETE | ✅ UI ready | ❌ **NEEDS BACKEND** |
| **`POST /api/sounds/upload`** | POST | ✅ UI ready (file upload) | ❌ **NEEDS BACKEND** |
| **`GET /api/settings/:ext`** | GET | ✅ UI ready | ❌ **NEEDS BACKEND** (unified settings) |
| **`PUT /api/settings/:ext`** | PUT | ✅ UI ready | ❌ **NEEDS BACKEND** (unified settings) |

### Backend features needed:

1. **`DELETE /api/users/:ext`** — Delete user account permanently
2. **`POST /api/sounds/upload`** — Accept audio file upload (caller tune / ringtone), store in `/sounds/`, return filename
3. **Unified settings endpoint** (`GET/PUT /api/settings/:ext`) — Store all user preferences:
   - `soundsEnabled`, `dtmfEnabled`
   - `callerTune`, `ringtone` (filename)
   - `pstnEnabled`, `pstnMobile`, `pstnCountryCode`
   - `recordingEnabled`, `voicemailEnabled`
4. **Call recording storage** — When `recordingEnabled` is true, persist recordings and expose `GET /api/recordings/:ext`
5. **Voicemail** — When `voicemailEnabled` is true, record voicemail on no-answer and expose `GET /api/voicemail/:ext`

### WebSocket messages the UI handles:
- `registered` — confirm registration
- `online_users` — full user list with presence
- `user_online` / `user_offline` — presence updates
- `incoming_call` — { from, fromName, callId }
- `call_ringing` / `call_answered` / `call_failed` / `call_ended`
- `call_event` — generic event
- `hangup` — { callId, from }
- `dtmf_sent` — { callId, digit }

## Go CRUD API Server (NOT YET STARTED — future work)
- [ ] Separate Go service for REST CRUD operations
- [ ] PostgreSQL backend
- [ ] JWT auth
- [ ] Node server calls  only for sip handles
- [ ] Go server is stateless, horizontally scalable

