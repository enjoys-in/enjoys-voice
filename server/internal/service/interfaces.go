package service

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/enjoys-in/enjoys-voice/api/internal/models"
	"github.com/enjoys-in/enjoys-voice/api/internal/repository"
)

type AuthService interface {
	Login(ctx context.Context, username, password string) (*models.User, error)
	Signup(ctx context.Context, name, mobile, password string) (*models.User, error)
	GetByExtension(ctx context.Context, ext string) (*models.User, error)
	UpdateName(ctx context.Context, ext, name string) (*models.User, error)
}

type UserService interface {
	GetAll(ctx context.Context) ([]models.User, error)
	GetByExtension(ctx context.Context, ext string) (*models.User, error)
	LookupByPhone(ctx context.Context, phone string) (*models.User, error)
	Delete(ctx context.Context, ext string) error
}

type SettingsService interface {
	Get(ctx context.Context, ext string) (*models.SettingsResponse, error)
	Update(ctx context.Context, ext string, input *SettingsInput) (*models.SettingsResponse, error)
	GetPstnForward(ctx context.Context, ext string) (*PstnForward, error)
	SetPstnForward(ctx context.Context, ext string, enabled bool, target string) (*PstnForward, error)
	WarmCache(ctx context.Context, ext string) error
}

// SystemSettingsInput is a partial update of the workspace-wide settings — only
// non-nil fields are applied so the dashboard can PATCH individual cards.
type SystemSettingsInput struct {
	BrandName              *string `json:"brand_name"`
	BrandTagline           *string `json:"brand_tagline"`
	AccentColor            *string `json:"accent_color"`
	LogoURL                *string `json:"logo_url"`
	SupportEmail           *string `json:"support_email"`
	DefaultRecording       *bool   `json:"default_recording"`
	DefaultVoicemail       *bool   `json:"default_voicemail"`
	AllowUserDND           *bool   `json:"allow_user_dnd"`
	RecordingRetentionDays *int    `json:"recording_retention_days"`
	MaxConcurrentCalls     *int    `json:"max_concurrent_calls"`
}

type SystemSettingsService interface {
	Get(ctx context.Context) (*models.SystemSettingsResponse, error)
	Update(ctx context.Context, input *SystemSettingsInput) (*models.SystemSettingsResponse, error)
}

// RatePlanInput is a partial update of a rate plan — only non-nil fields apply.
type RatePlanInput struct {
	Name     *string `json:"name"`
	Currency *string `json:"currency"`
	Default  *bool   `json:"default"`
}

// RateInput is a partial update of a single rate — only non-nil fields apply.
type RateInput struct {
	Prefix        *string  `json:"prefix"`
	Description   *string  `json:"description"`
	SellPerMin    *float64 `json:"sell_per_min"`
	BuyPerMin     *float64 `json:"buy_per_min"`
	SetupFee      *float64 `json:"setup_fee"`
	IncrementSecs *int     `json:"increment_secs"`
	MinSecs       *int     `json:"min_secs"`
}

// RatePlanDetail is a plan plus its full rate table (longest-prefix first).
type RatePlanDetail struct {
	models.RatePlanResponse
	Rates []models.RateResponse `json:"rates"`
}

// RateImportResult summarises a CSV bulk import: how many rows were created vs
// updated, and any per-row parse errors that were skipped.
type RateImportResult struct {
	Created int      `json:"created"`
	Updated int      `json:"updated"`
	Skipped int      `json:"skipped"`
	Errors  []string `json:"errors,omitempty"`
}

type RateService interface {
	ListPlans(ctx context.Context) ([]models.RatePlanResponse, error)
	GetPlan(ctx context.Context, id uint) (*RatePlanDetail, error)
	CreatePlan(ctx context.Context, input *RatePlanInput) (*models.RatePlanResponse, error)
	UpdatePlan(ctx context.Context, id uint, input *RatePlanInput) (*models.RatePlanResponse, error)
	DeletePlan(ctx context.Context, id uint) error

	ListRates(ctx context.Context, planID uint) ([]models.RateResponse, error)
	CreateRate(ctx context.Context, planID uint, input *RateInput) (*models.RateResponse, error)
	UpdateRate(ctx context.Context, id uint, input *RateInput) (*models.RateResponse, error)
	DeleteRate(ctx context.Context, id uint) error
	// ImportRates parses CSV text (columns: prefix, description, sell, buy, setup,
	// increment, min) and upserts the rows into the plan keyed on prefix.
	ImportRates(ctx context.Context, planID uint, csvData string) (*RateImportResult, error)
}

// BalanceService owns the prepaid wallet: reading a balance, listing the ledger
// and applying admin top-ups. The per-call debit is written by the Node engine
// at end-of-call (it owns the call path); the Go side only credits and reads.
type BalanceService interface {
	// Enabled reports whether prepaid billing is switched on (BILLING_PREPAID_ENABLED).
	Enabled() bool
	Get(ctx context.Context, ext string) (*models.UserBalance, error)
	// TopUp credits a wallet by a positive amount and records a ledger entry.
	TopUp(ctx context.Context, ext string, amount float64, reason string) (*models.UserBalance, error)
	ListTxns(ctx context.Context, ext string, limit int) ([]models.BalanceTxn, error)
}

// ErrBalanceDisabled is returned by mutating balance operations when prepaid
// billing is turned off (503).
var ErrBalanceDisabled = errors.New("prepaid billing is not enabled")

// ErrBalanceAmount is returned when a top-up amount is not a positive number (400).
var ErrBalanceAmount = errors.New("amount must be greater than zero")

// TrunkInput is a partial create/update of a SIP trunk — only non-nil fields
// are applied, so an edit that omits a field leaves the stored value intact. A
// nil or empty Password specifically preserves the existing credential.
type TrunkInput struct {
	Name         *string `json:"name"`
	Host         *string `json:"host"`
	Port         *int    `json:"port"`
	Transport    *string `json:"transport"`
	Username     *string `json:"username"`
	Password     *string `json:"password"`
	CallerNumber *string `json:"caller_number"`
	Prefix       *string `json:"prefix"`
	Codecs       *string `json:"codecs"`
	Enabled      *bool   `json:"enabled"`
}

// TrunkTestResult is the outcome of a connectivity probe (a single SIP OPTIONS
// ping). OK means a SIP status line came back; LatencyMs is the round trip.
type TrunkTestResult struct {
	OK        bool   `json:"ok"`
	LatencyMs int64  `json:"latency_ms"`
	Response  string `json:"response,omitempty"`
	Error     string `json:"error,omitempty"`
}

// TrunkService owns CRUD over upstream SIP trunks plus an OPTIONS-ping reachability
// test. It is the persistence/management layer; actual SIP signalling to these
// trunks is performed by the call engine.
type TrunkService interface {
	List(ctx context.Context) ([]models.TrunkResponse, error)
	Get(ctx context.Context, id uint) (*models.TrunkResponse, error)
	Create(ctx context.Context, input *TrunkInput) (*models.TrunkResponse, error)
	Update(ctx context.Context, id uint, input *TrunkInput) (*models.TrunkResponse, error)
	Delete(ctx context.Context, id uint) error
	// Test sends a SIP OPTIONS ping to the trunk and records the result.
	Test(ctx context.Context, id uint) (*TrunkTestResult, error)
}

// ErrTrunkNotFound is returned when a trunk id doesn't exist (404).
var ErrTrunkNotFound = errors.New("trunk not found")

// ErrTrunkInvalid is returned when required trunk fields are missing (400).
var ErrTrunkInvalid = errors.New("name and host are required")

// APIKeyInput is a partial create/update of a developer API key — only non-nil
// fields are applied. AllowedOrigins/AllowedIPs are full replacements when
// supplied. The destination number is required on create.
type APIKeyInput struct {
	Label             *string   `json:"label"`
	AllowedOrigins    *[]string `json:"allowed_origins"`
	AllowedIPs        *[]string `json:"allowed_ips"`
	DestinationNumber *string   `json:"destination_number"`
	CallerID          *string   `json:"caller_id"`
	DailyCap          *int      `json:"daily_cap"`
	DevMode           *bool     `json:"dev_mode"`
	Active            *bool     `json:"active"`
}

// APIKeyService owns CRUD over developer API keys for the click-to-call widget.
// Every operation is owner-scoped: the owner extension comes from the JWT and a
// caller can only see/modify their own keys. Create returns the plaintext secret
// exactly once (in APIKeyResponse.Secret).
type APIKeyService interface {
	List(ctx context.Context, owner string) ([]models.APIKeyResponse, error)
	Create(ctx context.Context, owner string, input *APIKeyInput) (*models.APIKeyResponse, error)
	Update(ctx context.Context, owner string, id uint, input *APIKeyInput) (*models.APIKeyResponse, error)
	Delete(ctx context.Context, owner string, id uint) error
}

// ErrAPIKeyNotFound is returned when a key id doesn't exist or isn't owned by
// the caller (404).
var ErrAPIKeyNotFound = errors.New("api key not found")

// ErrAPIKeyInvalid is returned when a required field is missing (400).
var ErrAPIKeyInvalid = errors.New("destination_number is required")

type CallService interface {
	GetAll(ctx context.Context) ([]models.CallRecord, error)
	GetByExtension(ctx context.Context, ext string) ([]models.CallRecord, error)
	Create(ctx context.Context, call *models.CallRecord) error
	DeleteByExtension(ctx context.Context, ext string) (int64, error)
	Stats(ctx context.Context, days int) (*models.CallStats, error)
}

type BlockService interface {
	GetByExtension(ctx context.Context, ext string) ([]string, error)
	Add(ctx context.Context, ext string, number string) error
	Remove(ctx context.Context, ext string, number string) error
}

type ForwardingService interface {
	Get(ctx context.Context, ext string) (*models.ForwardingResponse, error)
	Set(ctx context.Context, ext string, fwdType string, target string) error
}

type SoundService interface {
	Upload(ctx context.Context, ext string, soundType string, filename string, originalName string, path string) (*models.Sound, error)
	GetByExtension(ctx context.Context, ext string) ([]models.Sound, error)
	Delete(ctx context.Context, id uint, ext string) error
}

type IvrService interface {
	List(ctx context.Context) ([]models.IvrFlow, error)
	Get(ctx context.Context, id string) (*models.IvrFlow, error)
	Save(ctx context.Context, flow *models.IvrFlow) error
	Delete(ctx context.Context, id string) error
}

type AuditService interface {
	Query(ctx context.Context, q repository.AuditQuery) ([]models.AuditLog, error)
	GetByExtension(ctx context.Context, ext string, limit int) ([]models.AuditLog, error)
	Record(ctx context.Context, ext, event, detail string) error
}

type VoicemailService interface {
	List(ctx context.Context, ext string) ([]models.Voicemail, int64, error)
	Get(ctx context.Context, ext string, id uint) (*models.Voicemail, error)
	MarkRead(ctx context.Context, ext string, id uint) (int64, error)
	Delete(ctx context.Context, ext string, id uint) (int64, error)
}

// PstnForward is the flat PSTN call-forwarding view derived from UserSettings.
type PstnForward struct {
	Enabled bool   `json:"enabled"`
	Target  string `json:"target"`
}

// SettingsInput is the payload for updating settings
type SettingsInput struct {
	SoundsEnabled    *bool   `json:"sounds_enabled"`
	DtmfEnabled      *bool   `json:"dtmf_enabled"`
	CallerTune       *string `json:"caller_tune"`
	Ringtone         *string `json:"ringtone"`
	PstnEnabled      *bool   `json:"pstn_enabled"`
	PstnMobile       *string `json:"pstn_mobile"`
	PstnCountryCode  *string `json:"pstn_country_code"`
	RecordingEnabled *bool   `json:"recording_enabled"`
	VoicemailEnabled *bool   `json:"voicemail_enabled"`
	DND              *bool   `json:"dnd"`
	// RatePlanID assigns a billing plan. Raw so we can tell "field omitted"
	// (leave as-is) from an explicit null / 0 (clear → use the workspace default
	// plan) from a positive id (assign that plan). A single *uint can't make that
	// distinction because omitted and null both decode to nil.
	RatePlanID json.RawMessage `json:"rate_plan_id"`
}

// CallerIDService manages provider-native (BYON) outbound caller-ID
// verification. A user proves ownership of their own number via Twilio's
// Outgoing Caller IDs flow; only a verified number may be presented on
// browser→PSTN calls. These operations are intentionally separate from the
// generic settings update so a client cannot self-assert a verified number.
type CallerIDService interface {
	// StartVerification kicks off Twilio verification for number (E.164 built
	// from countryCode + number). Twilio calls the number; the returned
	// ValidationCode must be entered by the user to complete it.
	StartVerification(ctx context.Context, ext, number, countryCode string) (*CallerIDVerifyStart, error)
	// ConfirmVerification re-checks Twilio and flips the stored number to
	// verified once Twilio reports it as a validated caller ID.
	ConfirmVerification(ctx context.Context, ext string) (*CallerIDStatus, error)
	// Get returns the current caller-ID status for the extension.
	Get(ctx context.Context, ext string) (*CallerIDStatus, error)
	// Delete removes the verified caller ID (locally and on Twilio).
	Delete(ctx context.Context, ext string) error
}

// CallerIDVerifyStart is returned when verification begins. The user must enter
// ValidationCode on the call Twilio places to their number.
type CallerIDVerifyStart struct {
	Status         string `json:"status"`
	Number         string `json:"number"`
	ValidationCode string `json:"validationCode"`
	CallSid        string `json:"callSid"`
}

// CallerIDStatus is the public view of a user's outbound caller ID.
type CallerIDStatus struct {
	Number     string     `json:"number"`
	Verified   bool       `json:"verified"`
	VerifiedAt *time.Time `json:"verifiedAt"`
}

// ErrCallerIDUnavailable is returned when Twilio credentials are not configured
// so the caller-ID feature is disabled (handler maps it to 503).
var ErrCallerIDUnavailable = errors.New("caller id verification is not available")

// ErrCallerIDCooldown is returned when a verification was requested too soon
// after a previous attempt (handler maps it to 429).
var ErrCallerIDCooldown = errors.New("please wait before requesting another verification")

// OTPService handles SMS one-time-password flows: verifying a phone number on
// signup and passwordless mobile+OTP login. Codes are short-lived and stored in
// the cache (Valkey) with a TTL; delivery goes through the configured SMS
// gateway (Twilio Messages API). All mobile inputs are normalized the same way
// signup stores them, so keys and lookups line up.
type OTPService interface {
	// RequestSignupOTP sends a verification code to a NOT-yet-registered mobile.
	// Returns ErrMobileRegistered if the number already has an account.
	RequestSignupOTP(ctx context.Context, mobile string) error
	// VerifySignupOTP validates the signup code then creates the account
	// (delegating to AuthService.Signup) and returns the new user.
	VerifySignupOTP(ctx context.Context, name, mobile, password, code string) (*models.User, error)
	// RequestLoginOTP sends a login code to an EXISTING user's mobile. To avoid
	// account enumeration it reports success even when no such user exists (it
	// simply sends nothing); it still returns ErrOTPUnavailable when SMS is down.
	RequestLoginOTP(ctx context.Context, mobile string) error
	// VerifyLoginOTP validates the login code and returns the matching user.
	VerifyLoginOTP(ctx context.Context, mobile, code string) (*models.User, error)
}

// ErrOTPUnavailable is returned when no SMS gateway is configured so OTP cannot
// be delivered (handler maps it to 503).
var ErrOTPUnavailable = errors.New("otp delivery is not available")

// ErrOTPCooldown is returned when a code was requested again too soon (429).
var ErrOTPCooldown = errors.New("please wait before requesting another code")

// ErrOTPInvalid is returned when a submitted code is wrong or expired (400).
var ErrOTPInvalid = errors.New("invalid or expired code")

// ErrMobileRegistered is returned by signup-OTP when the number already has an
// account (handler maps it to 409).
var ErrMobileRegistered = errors.New("phone number already registered")
