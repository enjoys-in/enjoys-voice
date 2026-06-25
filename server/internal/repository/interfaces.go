package repository

import (
	"context"
	"time"

	"github.com/enjoys-in/enjoys-voice/api/internal/models"
)

type UserRepository interface {
	Create(ctx context.Context, user *models.User) error
	GetByExtension(ctx context.Context, ext string) (*models.User, error)
	GetByMobile(ctx context.Context, mobile string) (*models.User, error)
	GetByUsername(ctx context.Context, username string) (*models.User, error)
	GetAll(ctx context.Context) ([]models.User, error)
	UpdateName(ctx context.Context, ext, name string) error
	Delete(ctx context.Context, ext string) error
}

type SettingsRepository interface {
	Get(ctx context.Context, ext string) (*models.UserSettings, error)
	Upsert(ctx context.Context, settings *models.UserSettings) error
	Delete(ctx context.Context, ext string) error
}

type SystemSettingsRepository interface {
	Get(ctx context.Context) (*models.SystemSettings, error)
	Save(ctx context.Context, s *models.SystemSettings) error
}

// RateRepository owns rate plans and their per-destination rates. Rates are
// returned longest-prefix first so a matcher can take the first leading match.
type RateRepository interface {
	ListPlans(ctx context.Context) ([]models.RatePlan, error)
	GetPlan(ctx context.Context, id uint) (*models.RatePlan, error)
	CreatePlan(ctx context.Context, plan *models.RatePlan) error
	UpdatePlan(ctx context.Context, plan *models.RatePlan) error
	DeletePlan(ctx context.Context, id uint) error
	ClearDefault(ctx context.Context) error
	CountRates(ctx context.Context, planID uint) (int64, error)

	ListRates(ctx context.Context, planID uint) ([]models.Rate, error)
	GetRate(ctx context.Context, id uint) (*models.Rate, error)
	CreateRate(ctx context.Context, rate *models.Rate) error
	UpdateRate(ctx context.Context, rate *models.Rate) error
	DeleteRate(ctx context.Context, id uint) error
	// UpsertRates inserts or updates the given rates for a plan keyed on prefix,
	// all in one transaction. Returns counts of created vs updated rows.
	UpsertRates(ctx context.Context, planID uint, rates []models.Rate) (created int, updated int, err error)
}

// BalanceRepository owns the prepaid wallet and its ledger. Every balance
// mutation goes through Credit, which writes a signed ledger entry and adjusts
// the running balance in one transaction so the two can never diverge.
type BalanceRepository interface {
	// Get returns the wallet for an extension, or a zeroed wallet (not an error)
	// when none exists yet — an account that has never been topped up reads as 0.
	Get(ctx context.Context, ext string) (*models.UserBalance, error)
	// Credit applies a signed amount (positive = top-up, negative = charge) to a
	// wallet and records a matching ledger entry, atomically. When callID is
	// non-empty it is treated as an idempotency key: if a ledger row for that
	// (callID, reason) already exists the call is a no-op and the current wallet
	// is returned unchanged.
	Credit(ctx context.Context, ext string, amount float64, currency, reason, callID string) (*models.UserBalance, error)
	// ListTxns returns the most recent ledger entries for an extension, newest first.
	ListTxns(ctx context.Context, ext string, limit int) ([]models.BalanceTxn, error)
}

// TrunkRepository persists upstream SIP trunk definitions (PSTN gateways / ITSPs).
type TrunkRepository interface {
	List(ctx context.Context) ([]models.Trunk, error)
	Get(ctx context.Context, id uint) (*models.Trunk, error)
	Create(ctx context.Context, trunk *models.Trunk) error
	Update(ctx context.Context, trunk *models.Trunk) error
	Delete(ctx context.Context, id uint) error
	// SetStatus records the outcome of the most recent connectivity probe.
	SetStatus(ctx context.Context, id uint, status string, testedAt time.Time) error
}

// APIKeyRepository persists developer API keys for the embeddable click-to-call
// widget. Keys are owner-scoped (listed/managed by owner_extension).
type APIKeyRepository interface {
	ListByOwner(ctx context.Context, owner string) ([]models.APIKey, error)
	Get(ctx context.Context, id uint) (*models.APIKey, error)
	Create(ctx context.Context, key *models.APIKey) error
	Update(ctx context.Context, key *models.APIKey) error
	Delete(ctx context.Context, id uint) error
	// TouchLastUsed stamps when a key was last used to place a call.
	TouchLastUsed(ctx context.Context, id uint, at time.Time) error
}

type CallRepository interface {
	Create(ctx context.Context, call *models.CallRecord) error
	GetAll(ctx context.Context) ([]models.CallRecord, error)
	GetByExtension(ctx context.Context, ext string) ([]models.CallRecord, error)
	DeleteByExtension(ctx context.Context, ext string) (int64, error)
	Stats(ctx context.Context, days int) (*models.CallStats, error)
	StatsByExtension(ctx context.Context, ext string, days int) (*models.CallStats, error)
}

type BlockRepository interface {
	GetByExtension(ctx context.Context, ext string) ([]string, error)
	Add(ctx context.Context, block *models.BlockedNumber) error
	Remove(ctx context.Context, ext string, number string) error
	DeleteAll(ctx context.Context, ext string) error
}

type ForwardingRepository interface {
	Get(ctx context.Context, ext string) (*models.ForwardingResponse, error)
	Set(ctx context.Context, rule *models.ForwardingRule) error
	DeleteAll(ctx context.Context, ext string) error
}

type SoundRepository interface {
	Create(ctx context.Context, sound *models.Sound) error
	GetByExtension(ctx context.Context, ext string) ([]models.Sound, error)
	GetByID(ctx context.Context, id uint) (*models.Sound, error)
	Delete(ctx context.Context, id uint) error
	DeleteAll(ctx context.Context, ext string) error
}

type RecordingRepository interface {
	Create(ctx context.Context, rec *models.Recording) error
	GetByExtension(ctx context.Context, ext string) ([]models.Recording, error)
}

type VoicemailRepository interface {
	Create(ctx context.Context, vm *models.Voicemail) error
	GetByExtension(ctx context.Context, ext string) ([]models.Voicemail, error)
	GetByID(ctx context.Context, id uint) (*models.Voicemail, error)
	MarkRead(ctx context.Context, id uint) error
	Delete(ctx context.Context, id uint) error
	UnreadCount(ctx context.Context, ext string) (int64, error)
}

type IvrFlowRepository interface {
	GetAll(ctx context.Context) ([]models.IvrFlow, error)
	GetAllByOwner(ctx context.Context, owner string) ([]models.IvrFlow, error)
	GetByID(ctx context.Context, id string) (*models.IvrFlow, error)
	GetByExtension(ctx context.Context, ext string) (*models.IvrFlow, error)
	Upsert(ctx context.Context, flow *models.IvrFlow) error
	Delete(ctx context.Context, id string) error
}

// AuditQuery filters audit log lookups. Zero-value fields are ignored.
type AuditQuery struct {
	Extension string
	Event     string
	From      *time.Time
	To        *time.Time
	Limit     int
}

type AuditRepository interface {
	Create(ctx context.Context, log *models.AuditLog) error
	Query(ctx context.Context, q AuditQuery) ([]models.AuditLog, error)
	GetByExtension(ctx context.Context, ext string, limit int) ([]models.AuditLog, error)
}

// ScheduleRepository owns the global business-hours policy and per-user
// availability windows (SQL migration 005). Business hours are a single
// upsert-and-replace document; availability is keyed by extension.
type ScheduleRepository interface {
	GetBusinessHours(ctx context.Context) (*models.BusinessHoursPolicy, error)
	SaveBusinessHours(ctx context.Context, timezone string, enabled bool, windows []models.BusinessHoursWindow, exceptions []models.BusinessHoursException) (*models.BusinessHoursPolicy, error)
	ListAvailability(ctx context.Context, ext string) ([]models.UserAvailabilityWindow, error)
	ReplaceAvailability(ctx context.Context, ext string, windows []models.UserAvailabilityWindow) error
	GetPrompts(ctx context.Context) ([]models.RoutingPrompt, error)
	ReplacePrompts(ctx context.Context, prompts []models.RoutingPrompt) error
}
