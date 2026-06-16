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

type CallRepository interface {
	Create(ctx context.Context, call *models.CallRecord) error
	GetAll(ctx context.Context) ([]models.CallRecord, error)
	GetByExtension(ctx context.Context, ext string) ([]models.CallRecord, error)
	DeleteByExtension(ctx context.Context, ext string) (int64, error)
	Stats(ctx context.Context, days int) (*models.CallStats, error)
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
