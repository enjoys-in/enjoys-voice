package models

import "time"

// BusinessHoursPolicy is the single, global business-hours configuration. When
// disabled (or absent) the platform is treated as always open. The tables are
// created by SQL migration 005 (not GORM AutoMigrate), so these models map onto
// an existing schema and are only used for queries/writes.
type BusinessHoursPolicy struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	Timezone  string    `gorm:"size:64;not null;default:UTC" json:"timezone"`
	Enabled   bool      `gorm:"not null;default:false" json:"enabled"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`

	Windows []BusinessHoursWindow `gorm:"foreignKey:PolicyID;constraint:OnDelete:CASCADE" json:"windows"`
}

func (BusinessHoursPolicy) TableName() string { return "business_hours_policies" }

// BusinessHoursWindow is one open interval (minutes-from-midnight) on one day of
// the week (0 = Sunday … 6 = Saturday) for the global policy.
type BusinessHoursWindow struct {
	ID          uint      `gorm:"primaryKey" json:"id"`
	PolicyID    uint      `gorm:"index;not null" json:"policy_id"`
	DayOfWeek   int16     `gorm:"column:day_of_week;not null" json:"day_of_week"`
	StartMinute int16     `gorm:"column:start_minute;not null" json:"start_minute"`
	EndMinute   int16     `gorm:"column:end_minute;not null" json:"end_minute"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

func (BusinessHoursWindow) TableName() string { return "business_hours_windows" }

// UserAvailabilityWindow is one open interval for a single user's personal
// working hours. An extension with no enabled windows is treated as always
// available (backward compatible default).
type UserAvailabilityWindow struct {
	ID          uint      `gorm:"primaryKey" json:"id"`
	Extension   string    `gorm:"index;size:20;not null" json:"extension"`
	DayOfWeek   int16     `gorm:"column:day_of_week;not null" json:"day_of_week"`
	StartMinute int16     `gorm:"column:start_minute;not null" json:"start_minute"`
	EndMinute   int16     `gorm:"column:end_minute;not null" json:"end_minute"`
	Timezone    string    `gorm:"size:64;not null;default:UTC" json:"timezone"`
	Enabled     bool      `gorm:"not null;default:true" json:"enabled"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

func (UserAvailabilityWindow) TableName() string { return "user_availability_windows" }
