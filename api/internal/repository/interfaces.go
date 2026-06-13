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

type CallRepository interface {
	Create(ctx context.Context, call *models.CallRecord) error
	GetAll(ctx context.Context) ([]models.CallRecord, error)
	GetByExtension(ctx context.Context, ext string) ([]models.CallRecord, error)
	DeleteByExtension(ctx context.Context, ext string) (int64, error)
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
