package models

import "time"

// SystemSettings holds workspace-wide customization for the admin SaaS surface:
// branding (name / tagline / accent / logo) and default per-user policies that
// new accounts inherit. It is a SINGLETON — exactly one row, pinned to ID = 1.
type SystemSettings struct {
	ID           uint   `gorm:"primaryKey" json:"id"`
	BrandName    string `gorm:"size:120;default:'Enjoys Voice'" json:"brand_name"`
	BrandTagline string `gorm:"size:200" json:"brand_tagline"`
	AccentColor  string `gorm:"size:9;default:'#6366f1'" json:"accent_color"`
	LogoURL      string `gorm:"size:500" json:"logo_url"`
	SupportEmail string `gorm:"size:200" json:"support_email"`

	// Default per-user policies applied to the dashboard's feature toggles.
	DefaultRecording bool `gorm:"default:false" json:"default_recording"`
	DefaultVoicemail bool `gorm:"default:false" json:"default_voicemail"`
	AllowUserDND     bool `gorm:"default:true" json:"allow_user_dnd"`

	// Operational limits / retention.
	RecordingRetentionDays int `gorm:"default:30" json:"recording_retention_days"`
	MaxConcurrentCalls     int `gorm:"default:0" json:"max_concurrent_calls"` // 0 = unlimited

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (SystemSettings) TableName() string { return "system_settings" }

// SystemSettingsID is the fixed primary key of the singleton row.
const SystemSettingsID = 1

// SystemSettingsResponse is the flat DTO returned to the dashboard.
type SystemSettingsResponse struct {
	BrandName              string `json:"brand_name"`
	BrandTagline           string `json:"brand_tagline"`
	AccentColor            string `json:"accent_color"`
	LogoURL                string `json:"logo_url"`
	SupportEmail           string `json:"support_email"`
	DefaultRecording       bool   `json:"default_recording"`
	DefaultVoicemail       bool   `json:"default_voicemail"`
	AllowUserDND           bool   `json:"allow_user_dnd"`
	RecordingRetentionDays int    `json:"recording_retention_days"`
	MaxConcurrentCalls     int    `json:"max_concurrent_calls"`
}

func (s *SystemSettings) ToResponse() SystemSettingsResponse {
	return SystemSettingsResponse{
		BrandName:              s.BrandName,
		BrandTagline:           s.BrandTagline,
		AccentColor:            s.AccentColor,
		LogoURL:                s.LogoURL,
		SupportEmail:           s.SupportEmail,
		DefaultRecording:       s.DefaultRecording,
		DefaultVoicemail:       s.DefaultVoicemail,
		AllowUserDND:           s.AllowUserDND,
		RecordingRetentionDays: s.RecordingRetentionDays,
		MaxConcurrentCalls:     s.MaxConcurrentCalls,
	}
}
