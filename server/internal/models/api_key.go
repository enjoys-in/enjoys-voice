package models

import (
	"strings"
	"time"
)

// APIKey is a developer credential that lets an external website embed the
// click-to-call widget (or originate server-to-server). A key is OWNER-SCOPED
// (owner_extension is taken from the JWT, never the request body) and LOCKED to
// a single destination number: every call placed with it dials that number and
// nothing else. Calls are additionally gated by the allowed Origin domains and
// source IP allow-list configured here.
//
// Two secrets are issued:
//   - PublicKey  (pk_…)  — safe to ship in browser/widget code; identifies the key.
//   - SecretHash (sk_…)  — SHA-256 of a secret shown ONCE at creation, for
//     server-to-server originate. The plaintext never leaves the create response.
type APIKey struct {
	ID             uint   `gorm:"primaryKey" json:"id"`
	OwnerExtension string `gorm:"size:32;not null;index" json:"owner_extension"`
	Label          string `gorm:"size:80" json:"label"`
	// PublicKey is the publishable identifier embedded in the widget (pk_…).
	PublicKey string `gorm:"size:64;uniqueIndex;not null" json:"public_key"`
	// SecretHash is the SHA-256 hash of the server-to-server secret (sk_…). Never serialized.
	SecretHash string `gorm:"size:255" json:"-"`
	// AllowedOrigins is a comma-separated list of permitted browser Origins
	// (e.g. "https://acme.com,https://app.acme.com"). Empty = none allowed.
	AllowedOrigins string `gorm:"size:1024" json:"-"`
	// AllowedIPs is a comma-separated list of permitted source IPs or CIDRs
	// (e.g. "203.0.113.4,198.51.100.0/24"). Empty = any IP allowed.
	AllowedIPs string `gorm:"size:1024" json:"-"`
	// DestinationNumber is the single number every call with this key dials.
	DestinationNumber string `gorm:"size:40;not null" json:"destination_number"`
	// CallerID is the number presented to the destination (BYON / trunk number).
	CallerID string `gorm:"size:40" json:"caller_id"`
	// DailyCap limits calls per UTC day (0 = unlimited).
	DailyCap   int        `gorm:"default:0" json:"daily_cap"`
	Active     bool       `gorm:"default:true" json:"active"`
	LastUsedAt *time.Time `json:"last_used_at"`
	CreatedAt  time.Time  `json:"created_at"`
	UpdatedAt  time.Time  `json:"updated_at"`
}

func (APIKey) TableName() string { return "api_keys" }

// APIKeyResponse is the API view of a key: secret-free, with the CSV columns
// expanded to arrays and a HasSecret flag. Secret is populated ONLY in the
// create response (json omitempty) so the plaintext sk_… is shown exactly once.
type APIKeyResponse struct {
	ID                uint       `json:"id"`
	Label             string     `json:"label"`
	PublicKey         string     `json:"public_key"`
	Secret            string     `json:"secret,omitempty"`
	HasSecret         bool       `json:"has_secret"`
	AllowedOrigins    []string   `json:"allowed_origins"`
	AllowedIPs        []string   `json:"allowed_ips"`
	DestinationNumber string     `json:"destination_number"`
	CallerID          string     `json:"caller_id"`
	DailyCap          int        `json:"daily_cap"`
	Active            bool       `json:"active"`
	LastUsedAt        *time.Time `json:"last_used_at"`
	CreatedAt         time.Time  `json:"created_at"`
	UpdatedAt         time.Time  `json:"updated_at"`
}

func (k *APIKey) ToResponse() APIKeyResponse {
	return APIKeyResponse{
		ID:                k.ID,
		Label:             k.Label,
		PublicKey:         k.PublicKey,
		HasSecret:         k.SecretHash != "",
		AllowedOrigins:    splitAPIKeyCSV(k.AllowedOrigins),
		AllowedIPs:        splitAPIKeyCSV(k.AllowedIPs),
		DestinationNumber: k.DestinationNumber,
		CallerID:          k.CallerID,
		DailyCap:          k.DailyCap,
		Active:            k.Active,
		LastUsedAt:        k.LastUsedAt,
		CreatedAt:         k.CreatedAt,
		UpdatedAt:         k.UpdatedAt,
	}
}

// splitAPIKeyCSV turns a comma-separated column into a trimmed, empty-free slice
// (always non-nil so the JSON view is [] rather than null).
func splitAPIKeyCSV(raw string) []string {
	out := []string{}
	for _, part := range strings.Split(raw, ",") {
		if v := strings.TrimSpace(part); v != "" {
			out = append(out, v)
		}
	}
	return out
}
