package models

import "time"

type CallRecord struct {
	ID        uint       `gorm:"primaryKey" json:"id"`
	From      string     `gorm:"size:20;not null;index" json:"from"`
	To        string     `gorm:"size:20;not null;index" json:"to"`
	Status    string     `gorm:"size:20;not null" json:"status"` // answered, missed, busy, no_answer
	Duration  int        `gorm:"default:0" json:"duration"`      // seconds
	StartedAt time.Time  `gorm:"not null" json:"started_at"`
	EndedAt   *time.Time `json:"ended_at"`
	CreatedAt time.Time  `json:"created_at"`
}

func (CallRecord) TableName() string { return "call_records" }
