package models

import "time"

type Recording struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	Extension string    `gorm:"index;size:20;not null" json:"extension"`
	CallID    string    `gorm:"size:100" json:"call_id"`
	Filename  string    `gorm:"size:255;not null" json:"filename"`
	Duration  int       `gorm:"default:0" json:"duration"`
	Path      string    `gorm:"size:500;not null" json:"path"`
	CreatedAt time.Time `json:"created_at"`
}

func (Recording) TableName() string { return "recordings" }

type Voicemail struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	Extension string    `gorm:"index;size:20;not null" json:"extension"`
	From      string    `gorm:"size:20;not null" json:"from"`
	Filename  string    `gorm:"size:255;not null" json:"filename"`
	Duration  int       `gorm:"default:0" json:"duration"`
	Path      string    `gorm:"size:500;not null" json:"path"`
	Read      bool      `gorm:"default:false" json:"read"`
	CreatedAt time.Time `json:"created_at"`
}

func (Voicemail) TableName() string { return "voicemails" }
