# E911 / Emergency Calling Verification

> **Goal:** if you're using this as your primary phone system, emergency calling
> (E911 in the US, 112 in EU, etc.) must work. The dial plan already routes
> emergency numbers to the trunk, but the trunk needs a **registered address** to
> dispatch first responders. This feature adds verification, a warning banner,
> and documentation.
>
> **What already exists to build on:**
>   - Emergency dial plan: `config.dialplan.emergencyNumbers` (env
>     `EMERGENCY_NUMBERS`) → `EmergencyHandler` routes straight to the trunk
>     (`src/sip/routes/`).
>   - SIP trunk: `TrunkService.routeCall` — outbound PSTN calls via the trunk.
>   - Twilio: supports E911 via **Registered Addresses** (associated with phone
>     numbers). When a 911 call is placed, Twilio sends the registered address
>     to the PSAP.

## Twilio E911 Setup (manual, documented)

- [ ] Document the required Twilio console steps:
      1. Go to Twilio Console → Phone Numbers → Manage → Active Numbers.
      2. Select the DID used as `TRUNK_CALLER_NUMBER`.
      3. Under **Emergency Calling**, add a **Registered Address** (street,
         city, state, zip, country). Twilio validates the address with the PSAP
         database.
      4. Enable E911 for the number.
      5. Test by calling the non-emergency verification number (if available in
         your region) or verify via Twilio's test tools.
- [ ] Document in `SETUP.md` under a new "Emergency Calling (E911)" section.

## Go API — Address Registration

- [ ] New `EmergencyAddress` model (`server/internal/models/emergency.go`):
      ```go
      type EmergencyAddress struct {
        ID             uint   `gorm:"primaryKey"`
        Extension      string `gorm:"column:extension;uniqueIndex"`
        Street         string `gorm:"column:street;size:255"`
        City           string `gorm:"column:city;size:100"`
        State          string `gorm:"column:state;size:50"`
        PostalCode     string `gorm:"column:postal_code;size:20"`
        Country        string `gorm:"column:country;size:2"`   // ISO 3166-1 alpha-2
        Verified       bool   `gorm:"column:verified;default:false"`
        ProviderAddrID string `gorm:"column:provider_addr_id"` // Twilio address SID
        UpdatedAt      time.Time
      }
      ```
- [ ] Endpoints (authenticated, per-user):
      - `GET /api/g/emergency-address` — get the user's registered address.
      - `PUT /api/g/emergency-address` — create/update the address. Optionally
        validate with the trunk provider's API.
      - `POST /api/g/emergency-address/verify` — trigger provider-side
        verification (Twilio: create/update the address via API and check the
        `validated` status).
- [ ] **Twilio API integration** (optional, can be manual v1):
      - `POST /2010-04-01/Accounts/{Sid}/Addresses.json` — create an address.
      - `GET /2010-04-01/Accounts/{Sid}/Addresses/{Sid}.json` — check validation
        status.
      - Associate the address with the phone number via
        `POST /2010-04-01/Accounts/{Sid}/IncomingPhoneNumbers/{Sid}.json`
        with `EmergencyAddressSid`.

## Frontend — Warning Banner + Settings

### Warning Banner

- [ ] On the main app screen (or the keypad), show a **persistent warning banner**
      if E911 is not configured:
      ```
      ⚠️ Emergency calling is not configured. Set up your address in Settings
      to enable 911/112 calls.  [Configure →]
      ```
- [ ] The banner is shown when:
      - `EMERGENCY_NUMBERS` is set (emergency routing is enabled) AND
      - The user has no verified `EmergencyAddress`.
- [ ] The banner is hidden when the address is verified, or when emergency
      numbers are not configured (internal-only mode).

### Settings Section

- [ ] `SettingsScreen.tsx` — new "Emergency Calling" section:
      - Address form: street, city, state, postal code, country.
      - Status badge: ✅ Verified / ⚠️ Unverified / ❌ Not configured.
      - "Verify with provider" button (if Twilio API integration is built).
      - Info text: "Your address is sent to emergency services when you dial
        {emergencyNumbers}. Keep it up to date."

## Guardrails / Edge Cases

- [ ] **This is life-safety**: make the warning banner prominent and hard to
      dismiss. Don't let users disable the banner — only verifying the address
      hides it.
- [ ] **VoIP E911 limitations**: document that VoIP E911 may be less reliable
      than cellular 911. If the internet is down, calls can't be placed. The user
      should always have a cell phone as backup.
- [ ] **Address changes**: if the user moves, they must update their address.
      Show a periodic reminder (e.g., every 6 months: "Is your emergency address
      still correct?").
- [ ] **Multi-location**: VoIP calls can be made from anywhere. The registered
      address is the FIXED address sent to 911. If the user is at a different
      location, 911 dispatchers will go to the wrong place. Document this
      limitation prominently.
- [ ] **International**: different countries have different emergency numbers and
      registration requirements. v1 focuses on US E911 (Twilio). Other providers
      (Telnyx, etc.) have their own address registration APIs.
- [ ] **No trunk**: in internal-only mode (no `TRUNK_HOST`), emergency calls
      can't be placed. The warning should say "No PSTN trunk configured —
      emergency calls are unavailable."
