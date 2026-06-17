package models

import "time"

type UserSettings struct {
	ID               uint   `gorm:"primaryKey" json:"id"`
	UserID           uint   `gorm:"uniqueIndex;not null" json:"user_id"`
	Extension        string `gorm:"index;size:20;not null" json:"extension"`
	SoundsEnabled    bool   `gorm:"default:true" json:"sounds_enabled"`
	DtmfEnabled      bool   `gorm:"default:true" json:"dtmf_enabled"`
	CallerTune       string `gorm:"size:255;default:'caller_tune.wav'" json:"caller_tune"`
	Ringtone         string `gorm:"size:255;default:'ringtone.wav'" json:"ringtone"`
	PstnEnabled      bool   `gorm:"default:false" json:"pstn_enabled"`
	PstnMobile       string `gorm:"size:20" json:"pstn_mobile"`
	PstnCountryCode  string `gorm:"size:5;default:'+91'" json:"pstn_country_code"`
	RecordingEnabled bool   `gorm:"default:false" json:"recording_enabled"`
	VoicemailEnabled bool   `gorm:"default:false" json:"voicemail_enabled"`
	// DND (Do Not Disturb): when true, inbound calls do NOT ring the user's
	// device — they go straight to voicemail (or a silent SIP 480 when voicemail
	// is off). Intentional silence, distinct from genuine unreachability.
	DND bool `gorm:"column:dnd;default:false" json:"dnd"`
	// Billing rate plan assigned to this user. NULL = use the workspace default
	// plan (the Node rating engine falls back to the default when unset). Points
	// at rate_plans.id; no FK constraint so deleting a plan just reverts affected
	// users to the default rather than blocking the delete.
	RatePlanID *uint `gorm:"column:rate_plan_id" json:"rate_plan_id"`
	// Outbound caller ID (BYON). OutboundCallerID is the user's own real number
	// (E.164) to present on browser→PSTN calls. It may ONLY be presented once the
	// provider (Twilio) has verified ownership — CallerIDVerified gates that.
	// CallerIDValidationSid is the Twilio validation-request id from verify/start.
	// These are managed exclusively by the caller-id verify flow, never the
	// generic settings update, so a client cannot self-assert a verified number.
	OutboundCallerID      string     `gorm:"column:outbound_caller_id;size:20" json:"outbound_caller_id"`
	CallerIDVerified      bool       `gorm:"column:caller_id_verified;default:false" json:"caller_id_verified"`
	CallerIDVerifiedAt    *time.Time `gorm:"column:caller_id_verified_at" json:"caller_id_verified_at"`
	CallerIDValidationSid string     `gorm:"column:caller_id_validation_sid;size:64" json:"-"`
	CreatedAt             time.Time  `json:"created_at"`
	UpdatedAt             time.Time  `json:"updated_at"`

	User User `gorm:"foreignKey:UserID;constraint:OnDelete:CASCADE" json:"-"`
}

func (UserSettings) TableName() string { return "user_settings" }

// SettingsResponse is the cache-friendly flat structure
type SettingsResponse struct {
	Extension        string `json:"extension"`
	SoundsEnabled    bool   `json:"sounds_enabled"`
	DtmfEnabled      bool   `json:"dtmf_enabled"`
	CallerTune       string `json:"caller_tune"`
	Ringtone         string `json:"ringtone"`
	PstnEnabled      bool   `json:"pstn_enabled"`
	PstnMobile       string `json:"pstn_mobile"`
	PstnCountryCode  string `json:"pstn_country_code"`
	RecordingEnabled bool   `json:"recording_enabled"`
	VoicemailEnabled bool   `json:"voicemail_enabled"`
	DND              bool   `json:"dnd"`
	RatePlanID       *uint  `json:"rate_plan_id"`
	// Read-only caller-ID view (the verify flow owns writes).
	OutboundCallerID   string     `json:"outbound_caller_id"`
	CallerIDVerified   bool       `json:"caller_id_verified"`
	CallerIDVerifiedAt *time.Time `json:"caller_id_verified_at"`
}

func (s *UserSettings) ToResponse() SettingsResponse {
	return SettingsResponse{
		Extension:          s.Extension,
		SoundsEnabled:      s.SoundsEnabled,
		DtmfEnabled:        s.DtmfEnabled,
		CallerTune:         s.CallerTune,
		Ringtone:           s.Ringtone,
		PstnEnabled:        s.PstnEnabled,
		PstnMobile:         s.PstnMobile,
		PstnCountryCode:    s.PstnCountryCode,
		RecordingEnabled:   s.RecordingEnabled,
		VoicemailEnabled:   s.VoicemailEnabled,
		DND:                s.DND,
		RatePlanID:         s.RatePlanID,
		OutboundCallerID:   s.OutboundCallerID,
		CallerIDVerified:   s.CallerIDVerified,
		CallerIDVerifiedAt: s.CallerIDVerifiedAt,
	}
}
