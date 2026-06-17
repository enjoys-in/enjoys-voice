package models

import "time"

// Trunk is a configured upstream SIP trunk (a PSTN gateway / ITSP) the call
// engine can route external calls through. Credentials are stored for outbound
// authentication but never serialized back to clients — the API view exposes
// only HasPassword so an operator can tell whether a secret is set without it
// ever leaving the server.
type Trunk struct {
	ID           uint       `gorm:"primaryKey" json:"id"`
	Name         string     `gorm:"size:80;not null" json:"name"`
	Host         string     `gorm:"size:255;not null" json:"host"`
	Port         int        `gorm:"default:5060" json:"port"`
	Transport    string     `gorm:"size:4;default:'udp'" json:"transport"` // udp | tcp | tls
	Username     string     `gorm:"size:120" json:"username"`
	Password     string     `gorm:"size:255" json:"-"` // write-only; never serialized back
	CallerNumber string     `gorm:"size:40" json:"caller_number"`
	Prefix       string     `gorm:"size:20" json:"prefix"`
	Codecs       string     `gorm:"size:120" json:"codecs"` // comma-separated, e.g. "PCMU,PCMA,G729"
	Enabled      bool       `gorm:"default:true" json:"enabled"`
	LastStatus   string     `gorm:"size:20" json:"last_status"` // "" | ok | unreachable
	LastTestedAt *time.Time `json:"last_tested_at"`
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`
}

func (Trunk) TableName() string { return "trunks" }

// TrunkResponse is the API view of a trunk: the row minus the secret, with a
// HasPassword flag standing in for whether credentials are set.
type TrunkResponse struct {
	ID           uint       `json:"id"`
	Name         string     `json:"name"`
	Host         string     `json:"host"`
	Port         int        `json:"port"`
	Transport    string     `json:"transport"`
	Username     string     `json:"username"`
	HasPassword  bool       `json:"has_password"`
	CallerNumber string     `json:"caller_number"`
	Prefix       string     `json:"prefix"`
	Codecs       string     `json:"codecs"`
	Enabled      bool       `json:"enabled"`
	LastStatus   string     `json:"last_status"`
	LastTestedAt *time.Time `json:"last_tested_at"`
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`
}

func (t *Trunk) ToResponse() TrunkResponse {
	return TrunkResponse{
		ID:           t.ID,
		Name:         t.Name,
		Host:         t.Host,
		Port:         t.Port,
		Transport:    t.Transport,
		Username:     t.Username,
		HasPassword:  t.Password != "",
		CallerNumber: t.CallerNumber,
		Prefix:       t.Prefix,
		Codecs:       t.Codecs,
		Enabled:      t.Enabled,
		LastStatus:   t.LastStatus,
		LastTestedAt: t.LastTestedAt,
		CreatedAt:    t.CreatedAt,
		UpdatedAt:    t.UpdatedAt,
	}
}
