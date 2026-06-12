package service

import (
	"context"

	"github.com/enjoys-in/enjoys-voice/api/internal/models"
	"github.com/enjoys-in/enjoys-voice/api/internal/repository"
)

type AuthService interface {
	Login(ctx context.Context, username, password string) (*models.User, error)
	Signup(ctx context.Context, name, mobile, password string) (*models.User, error)
	GetByExtension(ctx context.Context, ext string) (*models.User, error)
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

type CallService interface {
	GetAll(ctx context.Context) ([]models.CallRecord, error)
	GetByExtension(ctx context.Context, ext string) ([]models.CallRecord, error)
	Create(ctx context.Context, call *models.CallRecord) error
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
}
