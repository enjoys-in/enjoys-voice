package models

import "time"

type UserSettings struct {
	ID               uint      `gorm:"primaryKey" json:"id"`
	UserID           uint      `gorm:"uniqueIndex;not null" json:"user_id"`
	Extension        string    `gorm:"index;size:20;not null" json:"extension"`
	SoundsEnabled    bool      `gorm:"default:true" json:"sounds_enabled"`
	DtmfEnabled      bool      `gorm:"default:true" json:"dtmf_enabled"`
	CallerTune       string    `gorm:"size:255;default:'caller_tune.wav'" json:"caller_tune"`
	Ringtone         string    `gorm:"size:255;default:'ringtone.wav'" json:"ringtone"`
	PstnEnabled      bool      `gorm:"default:false" json:"pstn_enabled"`
	PstnMobile       string    `gorm:"size:20" json:"pstn_mobile"`
	PstnCountryCode  string    `gorm:"size:5;default:'+91'" json:"pstn_country_code"`
	RecordingEnabled bool      `gorm:"default:false" json:"recording_enabled"`
	VoicemailEnabled bool      `gorm:"default:false" json:"voicemail_enabled"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`

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
}

func (s *UserSettings) ToResponse() SettingsResponse {
	return SettingsResponse{
		Extension:        s.Extension,
		SoundsEnabled:    s.SoundsEnabled,
		DtmfEnabled:      s.DtmfEnabled,
		CallerTune:       s.CallerTune,
		Ringtone:         s.Ringtone,
		PstnEnabled:      s.PstnEnabled,
		PstnMobile:       s.PstnMobile,
		PstnCountryCode:  s.PstnCountryCode,
		RecordingEnabled: s.RecordingEnabled,
		VoicemailEnabled: s.VoicemailEnabled,
	}
}
