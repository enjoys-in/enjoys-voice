package models

import "time"

// RatePlan is a named collection of destination Rates in one currency. Users are
// assigned a plan; exactly one plan may be marked Default for users without an
// explicit assignment. The `default` SQL keyword is reserved, so the column is
// pinned to `is_default` while the JSON/API stays `default`.
type RatePlan struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	Name      string    `gorm:"size:120;not null" json:"name"`
	Currency  string    `gorm:"size:3;default:'USD'" json:"currency"`
	Default   bool      `gorm:"column:is_default;default:false" json:"default"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (RatePlan) TableName() string { return "rate_plans" }

// RatePlanResponse is the API view of a plan, enriched with its rate count.
type RatePlanResponse struct {
	ID        uint      `json:"id"`
	Name      string    `json:"name"`
	Currency  string    `json:"currency"`
	Default   bool      `json:"default"`
	RateCount int64     `json:"rate_count"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (p *RatePlan) ToResponse(rateCount int64) RatePlanResponse {
	return RatePlanResponse{
		ID:        p.ID,
		Name:      p.Name,
		Currency:  p.Currency,
		Default:   p.Default,
		RateCount: rateCount,
		CreatedAt: p.CreatedAt,
		UpdatedAt: p.UpdatedAt,
	}
}
