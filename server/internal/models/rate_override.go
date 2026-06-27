package models

import "time"

// UserRateOverride is a per-user destination price that takes precedence over
// the user's assigned RatePlan during rating. It is matched by longest-prefix on
// the dialed E.164 number, exactly like a plan Rate, and is keyed uniquely on
// (extension, prefix). Overrides are admin-managed; the Node rating engine
// consults a caller's overrides first, then falls back to their assigned plan
// and finally the workspace default plan. Money columns use numeric(12,5) for
// sub-cent precision, mirroring Rate.
type UserRateOverride struct {
	ID            uint      `gorm:"primaryKey" json:"id"`
	Extension     string    `gorm:"size:20;not null;uniqueIndex:idx_user_rate_override_ext_prefix,priority:1" json:"extension"`
	Prefix        string    `gorm:"size:15;not null;uniqueIndex:idx_user_rate_override_ext_prefix,priority:2" json:"prefix"`
	Description   string    `gorm:"size:120" json:"description"`
	SellPerMin    float64   `gorm:"type:numeric(12,5);default:0" json:"sell_per_min"`
	BuyPerMin     float64   `gorm:"type:numeric(12,5);default:0" json:"buy_per_min"`
	SetupFee      float64   `gorm:"type:numeric(12,5);default:0" json:"setup_fee"`
	IncrementSecs int       `gorm:"default:60" json:"increment_secs"`
	MinSecs       int       `gorm:"default:0" json:"min_secs"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

func (UserRateOverride) TableName() string { return "user_rate_overrides" }

// RateOverrideResponse is the API view of a single per-user rate override.
type RateOverrideResponse struct {
	ID            uint      `json:"id"`
	Extension     string    `json:"extension"`
	Prefix        string    `json:"prefix"`
	Description   string    `json:"description"`
	SellPerMin    float64   `json:"sell_per_min"`
	BuyPerMin     float64   `json:"buy_per_min"`
	SetupFee      float64   `json:"setup_fee"`
	IncrementSecs int       `json:"increment_secs"`
	MinSecs       int       `json:"min_secs"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

func (o *UserRateOverride) ToResponse() RateOverrideResponse {
	return RateOverrideResponse{
		ID:            o.ID,
		Extension:     o.Extension,
		Prefix:        o.Prefix,
		Description:   o.Description,
		SellPerMin:    o.SellPerMin,
		BuyPerMin:     o.BuyPerMin,
		SetupFee:      o.SetupFee,
		IncrementSecs: o.IncrementSecs,
		MinSecs:       o.MinSecs,
		CreatedAt:     o.CreatedAt,
		UpdatedAt:     o.UpdatedAt,
	}
}
