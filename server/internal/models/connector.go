package models

import "time"

// Connector is a reusable outbound integration the IVR flow builder can trigger
// — currently an SMTP "email" sender or an HTTP "webhook". Type-specific
// settings (host, credentials, url, headers, …) live in the Config jsonb
// column; secret fields are redacted from API responses (see the service's
// ConnectorView). There can be many connectors of each type.
type Connector struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	Name      string    `gorm:"size:120;not null" json:"name"`
	Type      string    `gorm:"size:20;not null;index" json:"type"` // email | webhook
	Enabled   bool      `gorm:"default:true" json:"enabled"`
	Config    JSONB     `gorm:"type:jsonb" json:"-"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

func (Connector) TableName() string { return "connectors" }
