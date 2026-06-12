package models

import "time"

// AuditLog records a single audited event (login, call, settings change, etc.).
// `Extension` is the actor/owner; `Event` is a short machine code; `Detail`
// holds optional free-form context (often JSON-encoded).
type AuditLog struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	Extension string    `gorm:"index;size:20" json:"extension"`
	Event     string    `gorm:"index;size:64;not null" json:"event"`
	Detail    string    `gorm:"type:text" json:"detail"`
	CreatedAt time.Time `gorm:"index" json:"createdAt"`
}

func (AuditLog) TableName() string { return "audit_logs" }
