package models

import "time"

type ForwardingRule struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	UserID    uint      `gorm:"index;not null" json:"user_id"`
	Extension string    `gorm:"index;size:20;not null" json:"extension"`
	Type      string    `gorm:"size:20;not null" json:"type"` // busy, noAnswer, unavailable
	Target    string    `gorm:"size:20" json:"target"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`

	User User `gorm:"foreignKey:UserID;constraint:OnDelete:CASCADE" json:"-"`
}

func (ForwardingRule) TableName() string { return "forwarding_rules" }

type ForwardingResponse struct {
	Busy        *string `json:"busy"`
	NoAnswer    *string `json:"noAnswer"`
	Unavailable *string `json:"unavailable"`
}
