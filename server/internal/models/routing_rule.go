package models

import "time"

// RoutingRule is a per-user inbound call-routing override. A user configures
// where calls reaching them go: an IVR flow they built, another internal
// extension, a PSTN number, or straight to voicemail. Rules are owner-scoped
// (self-service) — a user only ever manages the rules they own, with no admin
// intervention required.
//
// Match semantics:
//   - MatchType "all"    → applies to every inbound call to the owner's own
//     extension (MatchNumber is blank).
//   - MatchType "number" → applies only when the dialed number equals
//     MatchNumber (e.g. a DID the owner receives on).
//
// Destination semantics (DestinationType / DestinationValue):
//   - "ivr"       → DestinationValue is the entry extension of an IVR flow.
//   - "extension" → DestinationValue is a target internal extension.
//   - "pstn"      → DestinationValue is an external phone number.
//   - "voicemail" → DestinationValue is blank; the caller is sent to the
//     owner's mailbox.
type RoutingRule struct {
	ID               uint      `gorm:"primaryKey" json:"id"`
	OwnerExtension   string    `gorm:"index;size:20;not null" json:"ownerExtension"`
	MatchType        string    `gorm:"size:10;not null" json:"matchType"`
	MatchNumber      string    `gorm:"index;size:40" json:"matchNumber,omitempty"`
	DestinationType  string    `gorm:"size:12;not null" json:"destinationType"`
	DestinationValue string    `gorm:"size:64" json:"destinationValue,omitempty"`
	Enabled          bool      `gorm:"not null" json:"enabled"`
	CreatedAt        time.Time `json:"createdAt"`
	UpdatedAt        time.Time `json:"updatedAt"`
}

func (RoutingRule) TableName() string { return "routing_rules" }
