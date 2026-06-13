package models

import "time"

type Sound struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	UserID    uint      `gorm:"index;not null" json:"user_id"`
	Extension string    `gorm:"index;size:20;not null" json:"extension"`
	Type      string    `gorm:"size:20;not null" json:"type"` // caller_tune, ringtone
	Filename  string    `gorm:"size:255;not null" json:"filename"`
	Original  string    `gorm:"size:255;not null" json:"original_name"`
	Path      string    `gorm:"size:500;not null" json:"path"`
	CreatedAt time.Time `json:"created_at"`

	User User `gorm:"foreignKey:UserID;constraint:OnDelete:CASCADE" json:"-"`
}

func (Sound) TableName() string { return "sounds" }
