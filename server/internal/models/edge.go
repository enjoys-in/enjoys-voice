package models

import "time"

// EdgeDevice is an on-prem branch appliance (a survivable PBX box on a customer
// LAN). It authenticates to the central API with a per-device bearer token and
// mirrors the extensions + local trunk assigned to it. Trunk credentials are
// stored plaintext at rest (same as upstream Trunk creds); the token is stored
// only as a SHA-256 hash and shown to the admin exactly once at create/rotate.
type EdgeDevice struct {
	ID            uint       `gorm:"primaryKey" json:"id"`
	DeviceID      string     `gorm:"size:64;uniqueIndex;not null" json:"device_id"`
	Name          string     `gorm:"size:120" json:"name"`
	TokenHash     string     `gorm:"size:255" json:"-"`
	Extensions    string     `gorm:"size:4096" json:"-"` // CSV of extension numbers
	TrunkUsername string     `gorm:"size:128" json:"-"`
	TrunkPassword string     `gorm:"size:128" json:"-"`
	TrunkRealm    string     `gorm:"size:128" json:"-"`
	TrunkProxy    string     `gorm:"size:128" json:"-"`
	TrunkRegister bool       `gorm:"default:true" json:"-"`
	Active        bool       `gorm:"default:true" json:"active"`
	LastSeenAt    *time.Time `json:"last_seen_at"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`
}

func (EdgeDevice) TableName() string { return "edge_devices" }

// EdgeDeviceResponse is the admin API view: token-free (except once on
// create/rotate), extensions expanded, trunk presence flagged.
type EdgeDeviceResponse struct {
	ID         uint       `json:"id"`
	DeviceID   string     `json:"device_id"`
	Name       string     `json:"name"`
	Token      string     `json:"token,omitempty"` // shown ONCE on create/rotate
	Extensions []string   `json:"extensions"`
	HasTrunk   bool       `json:"has_trunk"`
	TrunkProxy string     `json:"trunk_proxy"`
	TrunkRealm string     `json:"trunk_realm"`
	Active     bool       `json:"active"`
	LastSeenAt *time.Time `json:"last_seen_at"`
	CreatedAt  time.Time  `json:"created_at"`
	UpdatedAt  time.Time  `json:"updated_at"`
}

func (d *EdgeDevice) ToResponse() EdgeDeviceResponse {
	return EdgeDeviceResponse{
		ID:         d.ID,
		DeviceID:   d.DeviceID,
		Name:       d.Name,
		Extensions: splitAPIKeyCSV(d.Extensions),
		HasTrunk:   d.TrunkProxy != "" || d.TrunkUsername != "",
		TrunkProxy: d.TrunkProxy,
		TrunkRealm: d.TrunkRealm,
		Active:     d.Active,
		LastSeenAt: d.LastSeenAt,
		CreatedAt:  d.CreatedAt,
		UpdatedAt:  d.UpdatedAt,
	}
}

// EdgeExtensionDTO is the per-extension record the edge agent syncs into its
// FreeSWITCH directory. No password ⇒ the box uses its FreeSWITCH
// default_password (the agent's directory writer falls back to it).
type EdgeExtensionDTO struct {
	Extension      string `json:"extension"`
	Name           string `json:"name,omitempty"`
	CallerIDNumber string `json:"callerIdNumber,omitempty"`
}

// EdgeTrunkDTO is the local trunk gateway config the edge agent writes.
type EdgeTrunkDTO struct {
	Username string `json:"username"`
	Password string `json:"password"`
	Realm    string `json:"realm"`
	Proxy    string `json:"proxy"`
	Register bool   `json:"register"`
}

// EdgeCDR is a call-detail record shipped up from an edge appliance. Stored in
// its own table (Go-owned) so it never collides with the Node-owned
// call_records schema.
type EdgeCDR struct {
	ID             uint      `gorm:"primaryKey" json:"id"`
	DeviceID       string    `gorm:"size:64;index" json:"device_id"`
	Raw            string    `gorm:"type:text" json:"raw"`
	CallerIDName   string    `gorm:"size:200" json:"caller_id_name"`
	CallerIDNumber string    `gorm:"size:64" json:"caller_id_number"`
	Destination    string    `gorm:"size:64" json:"destination"`
	StartStamp     string    `gorm:"size:64" json:"start_stamp"`
	EndStamp       string    `gorm:"size:64" json:"end_stamp"`
	Duration       int       `json:"duration"`
	Billsec        int       `json:"billsec"`
	HangupCause    string    `gorm:"size:64" json:"hangup_cause"`
	UUID           string    `gorm:"size:64;index" json:"uuid"`
	ReceivedAt     time.Time `json:"received_at"`
}

func (EdgeCDR) TableName() string { return "edge_cdrs" }
