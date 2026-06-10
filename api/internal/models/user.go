package models

import "time"

type User struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	Extension string    `gorm:"uniqueIndex;size:20;not null" json:"extension"`
	Username  string    `gorm:"uniqueIndex;size:100;not null" json:"username"`
	Name      string    `gorm:"size:200;not null" json:"name"`
	Mobile    string    `gorm:"uniqueIndex;size:20;not null" json:"mobile"`
	Password  string    `gorm:"size:200;not null" json:"-"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (User) TableName() string { return "users" }
