package models

import "time"

type CallRecord struct {
	ID        uint       `gorm:"primaryKey" json:"id"`
	From      string     `gorm:"size:20;not null;index" json:"from"`
	To        string     `gorm:"size:20;not null;index" json:"to"`
	Status    string     `gorm:"size:20;not null" json:"status"` // ringing, answered, ended, missed, failed, voicemail, unreachable
	Duration  int        `gorm:"default:0" json:"duration"`      // seconds
	StartedAt time.Time  `gorm:"not null" json:"started_at"`
	EndedAt   *time.Time `json:"ended_at"`
	CreatedAt time.Time  `json:"created_at"`
	// Owning local extension each leg resolves to (Node stamps these at write
	// time). Lets call history be queried by user with an exact match that also
	// covers PSTN legs. Empty when the leg is external / not a local user.
	FromExt string `gorm:"size:20;index" json:"from_ext"`
	ToExt   string `gorm:"size:20;index" json:"to_ext"`
	// Written exclusively by the Node SIP engine on the shared table (see
	// src/services/postgres/call.repo.ts ensureCallSchema). The Go API only
	// reads them, so no gorm index is declared here — Node owns the unique
	// call_id index. CallID is the SIP Call-ID used as the stable client key.
	CallID    string `gorm:"size:100" json:"call_id"`
	Direction string `gorm:"size:10" json:"direction"` // inbound | outbound
	FromName  string `gorm:"size:200" json:"from_name"`
}

func (CallRecord) TableName() string { return "call_records" }
