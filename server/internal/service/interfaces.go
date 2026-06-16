package service

import (
	"context"
	"encoding/json"

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
