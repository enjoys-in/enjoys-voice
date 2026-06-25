package models

import "time"

// Contact is a user's personal address-book entry. Each contact is owned by the
// user that created it (OwnerExtension) and is private to that user — this is a
// personal contact list, not the global SIP directory (which is derived from
// registered users + live presence). Extension is a free-form dial target: an
// internal extension or an external number.
type Contact struct {
	ID             uint      `gorm:"primaryKey" json:"id"`
	OwnerExtension string    `gorm:"index;size:20;not null" json:"ownerExtension"`
	Name           string    `gorm:"size:120;not null" json:"name"`
	Extension      string    `gorm:"size:40;not null" json:"extension"`
	Username       string    `gorm:"size:120" json:"username,omitempty"`
	CreatedAt      time.Time `json:"createdAt"`
	UpdatedAt      time.Time `json:"updatedAt"`
}

func (Contact) TableName() string { return "contacts" }
