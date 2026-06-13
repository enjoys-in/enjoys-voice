package models

import "time"

type BlockedNumber struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	UserID    uint      `gorm:"index;not null" json:"user_id"`
	Extension string    `gorm:"index;size:20;not null" json:"extension"`
	Number    string    `gorm:"size:20;not null" json:"number"`
	CreatedAt time.Time `json:"created_at"`

	User User `gorm:"foreignKey:UserID;constraint:OnDelete:CASCADE" json:"-"`
}

func (BlockedNumber) TableName() string { return "blocked_numbers" }
