# UI Redesign — TODO

## Design System
- [ ] Mobile-first layout (375px base, scales to tablet/desktop)
- [ ] Dark theme SaaS design (glass morphism + gradients)
- [ ] Reusable component library in `web/app/components/ui/`
- [ ] Fully typed props with TypeScript interfaces
- [ ] Responsive: mobile (375-768), tablet (768-1024), desktop (1024+)

## Navigation & Layout
- [ ] Bottom tab bar (mobile): Calls, Contacts, Keypad, Settings
- [ ] Sidebar (desktop): same tabs vertically
- [ ] Header with user avatar + status indicator
- [ ] App shell with SSR layout + client interactivity

## Screens

### 1. Auth (Login / Signup)
- [ ] Login: mobile number + password
- [ ] Signup: country code selector + mobile number + name + password
- [ ] OTP verification screen (future: connect to SMS gateway)
- [ ] Sleek centered card design
- [ ] Form validation (client-side zod)

### 2. Calls (Recent)
- [ ] List of recent calls (from `/api/calls`)
- [ ] Each row: avatar, name, direction icon (↗️ ↙️ ❌), time, duration
- [ ] Tap to call back
- [ ] Pull-to-refresh on mobile
- [ ] Empty state illustration

### 3. Contacts (Online Users)
- [ ] List all users with online/offline status (green dot)
- [ ] Search/filter bar
- [ ] Tap to call
- [ ] Long press → block/unblock
- [ ] Show "online" users first, sorted

### 4. Keypad (Dial Pad)
- [ ] Full T9 dial pad
- [ ] Number display with backspace
- [ ] Call button (green circle)
- [ ] Quick-dial from contacts

### 5. Call Screen (Active Call)
- [ ] Full-screen overlay
- [ ] States: ringing (pulse animation), connected (timer), declined (red), no_answer
- [ ] Controls: mute, speaker, keypad, hold, hang up
- [ ] Caller tune plays during outbound ringing
- [ ] Ringtone plays for incoming
- [ ] Busy tone on decline (auto-dismiss after 3s)

### 6. Incoming Call
- [ ] Full-screen modal overlay
- [ ] Accept (green) / Decline (red) buttons
- [ ] Caller name + avatar + extension
- [ ] Ringtone audio

### 7. Settings
- [ ] Profile section (name, extension, mobile number, avatar)
- [ ] **Call Forwarding**
  - [ ] On Busy → select extension or disable
  - [ ] On No Answer → select extension or disable
  - [ ] On Unavailable → select extension or disable
- [ ] **Block List**
  - [ ] Show blocked numbers
  - [ ] Add/remove blocked number
- [ ] **Sounds**
  - [ ] Set custom caller tune (select from list)
  - [ ] Set custom ringtone (select from list)
  - [ ] Enable/disable sounds
- [ ] **PSTN**
  - [ ] Enable PSTN fallback toggle
  - [ ] Mobile number for PSTN routing
  - [ ] Country code selector
- [ ] **Recording**
  - [ ] Enable call recording toggle
  - [ ] List past recordings
- [ ] **Voicemail**
  - [ ] Enable voicemail toggle
  - [ ] Greeting message setting

## Components Library (`web/app/components/ui/`)
- [ ] `Avatar` — initials + color, online dot
- [ ] `Button` — primary, secondary, danger, icon variants
- [ ] `Input` — text, tel, password with label + error
- [ ] `Select` — dropdown with search
- [ ] `Toggle` — switch component
- [ ] `Badge` — status badges
- [ ] `Card` — glass card container
- [ ] `Modal` — overlay modal
- [ ] `TabBar` — bottom navigation
- [ ] `ListItem` — standard list row
- [ ] `EmptyState` — illustration + message
- [ ] `PhoneInput` — country code + number

## Hooks
- [ ] `useSipPhone` — SIP call management (exists, enhance)
- [ ] `useWebSocket` — WS connection (exists, enhance)
- [ ] `useAuth` — login/signup state management
- [ ] `useSettings` — settings CRUD via API
- [ ] `useContacts` — user list + presence
- [ ] `useCallHistory` — call logs from API

## Technical
- [ ] Server components for data fetching where possible
- [ ] Client components for interactive parts (SIP, WS)
- [ ] Zod schemas for form validation
- [ ] TypeScript strict mode
- [ ] Tailwind responsive utilities
- [ ] next/dynamic for SIP.js (client-only)
- [ ] **Zustand** for global state (auth, call state, contacts, settings)
- [ ] Stores: `useAuthStore`, `useCallStore`, `useContactStore`, `useSettingsStore`

## Audio & UX
- [ ] Play "tu-tu-tu" dialing tone immediately when call initiated (before server response)
- [ ] Switch to caller tune when server sends `ringing` event
- [ ] Silence gap elimination: instant local feedback → server event → actual ringback
- [ ] All tones from `/sounds/` directory (dialing, ringback, busy, ringtone)

## Go CRUD API Server (alongside Node SIP/WS server)
- [ ] Separate Go service for REST CRUD operations
- [ ] Handles: user settings, block list, forwarding rules, call history, recordings metadata
- [ ] Endpoints:
  - [ ] `POST /api/auth/signup` — mobile + password signup
  - [ ] `POST /api/auth/login` — mobile + password login
  - [ ] `GET/PUT /api/settings/:userId` — all user settings
  - [ ] `GET/POST/DELETE /api/block/:userId` — block list CRUD
  - [ ] `GET/POST /api/forwarding/:userId` — forwarding rules
  - [ ] `GET /api/calls/:userId` — call history
  - [ ] `GET/POST/DELETE /api/recordings/:userId` — recordings
  - [ ] `GET/PUT /api/sounds/:userId` — caller tune / ringtone selection
  - [ ] `GET/PUT /api/pstn/:userId` — PSTN settings
- [ ] PostgreSQL/SQLite backend
- [ ] JWT auth
- [ ] Node server calls Go API internally for persistent data
- [ ] Go server is stateless, horizontally scalable

