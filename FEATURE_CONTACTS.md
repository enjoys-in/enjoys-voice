# Server-Side Contact Manager

> **Goal:** a server-persisted personal phonebook so contacts survive browser
> clears, sync to the mobile app, and enrich caller ID on incoming calls. Extends
> the existing local `contactStore` into a full CRUD backed by Postgres.
>
> **What already exists to build on:**
>   - **Go API contact CRUD** — `server/internal/models/contact.go`,
>     `contact_handler.go`, repo, service. The `contacts` table and REST
>     endpoints (`GET/POST/PUT/DELETE /api/g/contacts`) **already exist**.
>   - **Frontend contact store** — `web/app/stores/contact.store.ts` with
>     `fetchMyContacts`, `addContact`, `updateContact`, `removeContact`. The
>     `ContactsScreen.tsx` is fully wired — add, edit, delete, search, call.
>   - **Caller-name resolution chain** — `AppShell.tsx` resolves names via
>     `contactStore.findContact(target)` → WS `lookup` → extension. Contacts
>     feed into this.
>   - **Database phone index** — `DatabaseService.phoneIndex` maps phone →
>     extension. Contacts could extend this for external numbers.
>
> **What's MISSING** (the actual feature work):

## 1. Phone Number Field

The existing `Contact` model has `{ name, extension }` only. For a real
phonebook you need a **phone number** (mobile, PSTN, international).

- [ ] Go model: add `Phone string gorm:"column:phone;size:20"` to the `Contact`
      model. AutoMigrate adds the column.
- [ ] Extend the contact handler/service to accept and validate `phone` in
      create/update. Normalize to E.164 if present. Phone is optional (a contact
      can have just an extension, just a phone, or both).
- [ ] Frontend: add a "Phone number" field to the Add/Edit Contact dialog
      (`ContactsScreen.tsx`). Show it in the contact list as a subtitle alongside
      the extension.

## 2. Notes / Memo Field

- [ ] Go model: add `Notes string gorm:"column:notes;type:text"`.
- [ ] Frontend: add a multi-line "Notes" field to the Add/Edit dialog. Show a
      truncated preview in the list or a detail view.

## 3. Contact Avatar / Photo

- [ ] Go model: add `AvatarUrl string gorm:"column:avatar_url;size:500"`.
- [ ] Option A: URL-only (user pastes a link). Simplest.
- [ ] Option B: file upload (like the sound upload). Store in
      `server/uploads/avatars/<ext>_<contactId>.jpg`. Serve via
      `GET /api/g/contacts/:id/avatar`. Reuse the existing `multipart/form-data`
      handling from `sound_handler.go`.
- [ ] Frontend: show the avatar in the `Avatar` component instead of initials.
      Upload widget in the edit dialog.

## 4. Caller ID Enrichment (incoming call name from contacts)

This is the **highest-value** part: when an unknown number rings, show the saved
contact name instead of the raw number.

- [ ] **Node-side**: on inbound INVITE, after resolving the caller's extension
      (step 2 in the call flow), also check the **owner's contacts** for a
      matching phone number. If found, use the contact name as `fromName` in the
      WS `incoming_call` event.
      - This requires contacts to be accessible to the Node engine. Options:
        (a) Load into memory via LISTEN/NOTIFY (like users/settings). Too much
            data if contacts grow large. Only viable for small-scale (personal use).
        (b) Query Postgres on the call path (latency: ~2ms for an indexed lookup).
            Acceptable for personal use; add a cache with TTL.
        (c) Query the Go API from Node (HTTP round-trip). Slower, more complex.
      - **Recommended for single-user**: (a) — load all contacts into memory at
        startup + sync via LISTEN/NOTIFY. You'll have < 1000 contacts.
- [ ] New `contacts_changed` Postgres LISTEN/NOTIFY channel + trigger on the
      `contacts` table. New `ContactSyncListener` in Node, modeled on
      `SettingsSyncListener`. On change, reload the affected user's contacts.
- [ ] `DatabaseService`: add a `contactsByPhone` Map (`phone → { name, extension }`)
      built from the loaded contacts. `lookupContactName(ownerExt, callerPhone)`
      → the saved name, or undefined.
- [ ] Hook into `sip.server.ts` `handleInvite()`: after resolving the caller's
      identity, check `db.lookupContactName(calleeExt, callerNumber)`. If found,
      use it as `fromName` in the WS notification and call log.

## 5. Auto-Suggest Contacts from Call History

- [ ] Frontend: after a call with an unsaved number, show a toast / prompt:
      "You talked to +91-98xxx — save as a contact?" with a quick-add button.
- [ ] Implementation: on call-end (WS `call_ended` event), check if the remote
      number is in the contact store. If not, show the suggestion.
- [ ] The suggestion should pre-fill the phone number and let the user just type
      a name.

## 6. Import / Export

- [ ] **Import from CSV / vCard**: `POST /api/g/contacts/import` — accept a CSV
      (name, phone, extension, notes) or a `.vcf` file. Parse and bulk-insert.
      Dedup by phone number.
- [ ] **Export to CSV**: `GET /api/g/contacts/export` — download all contacts as
      a CSV. Content-Disposition: attachment.
- [ ] **Google Contacts import** (optional, v2): OAuth2 flow to read the user's
      Google contacts. Complex; defer unless explicitly requested.
- [ ] Frontend: import/export buttons in the Contacts screen header.

## 7. Contact Groups / Tags (optional)

- [ ] `ContactGroup` model: `{ id, name, ownerExtension, createdAt }`.
- [ ] `contact_group_members` join table: `{ contactId, groupId }`.
- [ ] Frontend: group filter in the contacts list, assign groups in the edit
      dialog.
- [ ] **Defer this** — it's nice-to-have for personal use.

## Guardrails / Edge Cases

- [ ] **Ownership**: contacts are per-user (`ownerExtension` from JWT). A user
      can never read/write another user's contacts. The existing handler already
      enforces this.
- [ ] **Duplicate detection**: on add/import, warn if a contact with the same
      phone number already exists. Don't hard-block — the user may want two
      entries (e.g. "Bob - Work" and "Bob - Personal").
- [ ] **Phone number normalization**: strip spaces, dashes, parentheses. Store
      in a consistent format (E.164 or raw digits). Index for fast lookup.
- [ ] **Pagination**: the existing `GET /api/g/contacts` should support
      `?page=1&limit=50` for users with large contact lists. Search should be
      server-side (`?q=bob` → SQL `ILIKE '%bob%'`).
- [ ] **Mobile sync**: the Flutter app should use the same Go API endpoints.
      Contacts are already server-side, so the app just fetches on login.
      Offline caching is a v2 concern.
