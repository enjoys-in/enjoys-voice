package models

import (
	"database/sql/driver"
	"fmt"
	"strings"
	"time"
)

// dateLayout is the canonical calendar-date format used on the wire and in
// Postgres DATE columns.
const dateLayout = "2006-01-02"

// DateOnly is a calendar date (no time-of-day) that serialises as "YYYY-MM-DD"
// in JSON and maps to a Postgres DATE column. It keeps holiday/exception dates
// free of spurious time/timezone components in both the API and the database.
type DateOnly struct{ time.Time }

func (d DateOnly) MarshalJSON() ([]byte, error) {
	return []byte(`"` + d.Format(dateLayout) + `"`), nil
}

func (d *DateOnly) UnmarshalJSON(b []byte) error {
	s := strings.Trim(string(b), `"`)
	if s == "" || s == "null" {
		return nil
	}
	t, err := time.Parse(dateLayout, s)
	if err != nil {
		return fmt.Errorf("invalid date %q (want YYYY-MM-DD): %w", s, err)
	}
	d.Time = t
	return nil
}

// Scan implements sql.Scanner so GORM can read a DATE column (returned as
// time.Time by the driver, or a string/[]byte) into a DateOnly.
func (d *DateOnly) Scan(v interface{}) error {
	switch t := v.(type) {
	case nil:
		return nil
	case time.Time:
		d.Time = t
	case string:
		parsed, err := time.Parse(dateLayout, t[:min(len(t), 10)])
		if err != nil {
			return err
		}
		d.Time = parsed
	case []byte:
		parsed, err := time.Parse(dateLayout, string(t[:min(len(t), 10)]))
		if err != nil {
			return err
		}
		d.Time = parsed
	default:
		return fmt.Errorf("cannot scan %T into DateOnly", v)
	}
	return nil
}

// Value implements driver.Valuer so writes store a bare calendar date.
func (d DateOnly) Value() (driver.Value, error) {
	return d.Format(dateLayout), nil
}

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

	Windows    []BusinessHoursWindow    `gorm:"foreignKey:PolicyID;constraint:OnDelete:CASCADE" json:"windows"`
	Exceptions []BusinessHoursException `gorm:"foreignKey:PolicyID;constraint:OnDelete:CASCADE" json:"exceptions"`
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

// BusinessHoursException is a one-off calendar-date override of the weekly
// schedule (a holiday or special day). When ClosedAllDay the company is shut for
// the whole date; otherwise StartMinute/EndMinute define the only open window
// that day. A matching exception takes precedence over the weekly windows.
type BusinessHoursException struct {
	ID           uint      `gorm:"primaryKey" json:"id"`
	PolicyID     uint      `gorm:"index;not null" json:"policy_id"`
	Date         DateOnly  `gorm:"column:exception_date;type:date;not null" json:"date"`
	ClosedAllDay bool      `gorm:"column:closed_all_day;not null;default:true" json:"closed_all_day"`
	StartMinute  *int16    `gorm:"column:start_minute" json:"start_minute,omitempty"`
	EndMinute    *int16    `gorm:"column:end_minute" json:"end_minute,omitempty"`
	Note         string    `gorm:"size:200;not null;default:''" json:"note"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

func (BusinessHoursException) TableName() string { return "business_hours_exceptions" }

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
