package models

import "time"

// Rate is one destination price inside a RatePlan, matched by longest-prefix on
// the dialed E.164 number (e.g. `91` India, `9180` Bangalore). Money columns use
// numeric(12,5) for sub-cent precision. The billed duration on a call is
// `max(MinSecs, ceil(duration / IncrementSecs) × IncrementSecs)` and the cost is
// `SetupFee + SellPerMin × billedSecs/60`.
type Rate struct {
	ID            uint      `gorm:"primaryKey" json:"id"`
	RatePlanID    uint      `gorm:"index;not null" json:"rate_plan_id"`
	Prefix        string    `gorm:"size:15;index;not null" json:"prefix"`
	Description   string    `gorm:"size:120" json:"description"`
	SellPerMin    float64   `gorm:"type:numeric(12,5);default:0" json:"sell_per_min"`
	BuyPerMin     float64   `gorm:"type:numeric(12,5);default:0" json:"buy_per_min"`
	SetupFee      float64   `gorm:"type:numeric(12,5);default:0" json:"setup_fee"`
	IncrementSecs int       `gorm:"default:60" json:"increment_secs"`
	MinSecs       int       `gorm:"default:0" json:"min_secs"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

func (Rate) TableName() string { return "rates" }

// RateResponse is the API view of a single rate.
type RateResponse struct {
	ID            uint      `json:"id"`
	RatePlanID    uint      `json:"rate_plan_id"`
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

func (r *Rate) ToResponse() RateResponse {
	return RateResponse{
		ID:            r.ID,
		RatePlanID:    r.RatePlanID,
		Prefix:        r.Prefix,
		Description:   r.Description,
		SellPerMin:    r.SellPerMin,
		BuyPerMin:     r.BuyPerMin,
		SetupFee:      r.SetupFee,
		IncrementSecs: r.IncrementSecs,
		MinSecs:       r.MinSecs,
		CreatedAt:     r.CreatedAt,
		UpdatedAt:     r.UpdatedAt,
	}
}
