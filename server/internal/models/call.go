package models

import "time"

type CallRecord struct {
	ID        uint       `gorm:"primaryKey" json:"id"`
	From      string     `gorm:"size:20;not null;index" json:"from"`
	To        string     `gorm:"size:20;not null;index" json:"to"`
	Status    string     `gorm:"size:20;not null" json:"status"` // ringing, answered, ended, missed, failed, voicemail, unreachable
	Duration  int        `gorm:"default:0" json:"duration"`      // seconds
	StartedAt time.Time  `gorm:"not null" json:"started_at"`
	EndedAt   *time.Time `json:"ended_at"`
	CreatedAt time.Time  `json:"created_at"`
	// Owning local extension each leg resolves to (Node stamps these at write
	// time). Lets call history be queried by user with an exact match that also
	// covers PSTN legs. Empty when the leg is external / not a local user.
	FromExt string `gorm:"size:20;index" json:"from_ext"`
	ToExt   string `gorm:"size:20;index" json:"to_ext"`
	// Written exclusively by the Node SIP engine on the shared table (see
	// src/services/postgres/call.repo.ts ensureCallSchema). The Go API only
	// reads them, so no gorm index is declared here — Node owns the unique
	// call_id index. CallID is the SIP Call-ID used as the stable client key.
	CallID    string `gorm:"size:100" json:"call_id"`
	Direction string `gorm:"size:10" json:"direction"` // inbound | outbound
	FromName  string `gorm:"size:200" json:"from_name"`
	// Billing/rating columns — written by the Node engine when a billable leg
	// ends (longest-prefix rate × billed duration). Additive; the Go API only
	// reads them for spend reporting, so no index is declared. Non-billable legs
	// (missed/failed/unreachable/ringing) stay at zero cost.
	Cost       float64    `gorm:"type:numeric(12,5);default:0" json:"cost"`
	Currency   string     `gorm:"size:3" json:"currency"`
	RatePrefix string     `gorm:"size:15" json:"rate_prefix"`
	BilledSecs int        `gorm:"default:0" json:"billed_secs"`
	RatedAt    *time.Time `json:"rated_at"`
}

func (CallRecord) TableName() string { return "call_records" }

// CallStats is an aggregate, read-only view of the call_records table used by
// the admin dashboard. It is computed on demand (COUNT/GROUP BY) and is NOT a
// persisted table — it has no TableName and is never auto-migrated.
type CallStats struct {
	RangeDays       int               `json:"rangeDays"`
	TotalCalls      int64             `json:"totalCalls"`
	Answered        int64             `json:"answered"`
	Missed          int64             `json:"missed"`
	Failed          int64             `json:"failed"`
	Voicemail       int64             `json:"voicemail"`
	Unreachable     int64             `json:"unreachable"`
	Inbound         int64             `json:"inbound"`
	Outbound        int64             `json:"outbound"`
	ConnectionRate  float64           `json:"connectionRate"` // answered / total (0..1)
	AbandonedRate   float64           `json:"abandonedRate"`  // (missed+unreachable+failed) / total (0..1)
	AvgDuration     int64             `json:"avgDuration"`    // seconds, answered legs only
	TotalDuration   int64             `json:"totalDuration"`  // seconds
	StatusBreakdown []StatusCount     `json:"statusBreakdown"`
	Series          []CallStatsBucket `json:"series"` // per-day, oldest → newest
}

// StatusCount is one slice of the status breakdown (status → count).
type StatusCount struct {
	Status string `json:"status"`
	Count  int64  `json:"count"`
}

// CallStatsBucket is one day of the calls-over-time series.
type CallStatsBucket struct {
	Date     string `json:"date"` // YYYY-MM-DD
	Total    int64  `json:"total"`
	Inbound  int64  `json:"inbound"`
	Outbound int64  `json:"outbound"`
	Answered int64  `json:"answered"`
}
