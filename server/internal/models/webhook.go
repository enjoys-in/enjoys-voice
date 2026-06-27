package models

import "time"

// Webhook is a per-user outbound HTTP callback fired on call lifecycle events.
// A user registers a URL and the set of events they care about; the SIP engine
// then POSTs a signed JSON payload to that URL (asynchronously, off the call
// path) whenever a matching call involving the user occurs. Webhooks are
// owner-scoped (self-service) — a user only ever manages the webhooks they own.
//
// Secret is used to HMAC-SHA256 sign each delivery (the signature rides in the
// X-Webhook-Signature header) so receivers can verify authenticity; it is
// generated automatically when omitted and is never returned by the API.
//
// Events is a comma-separated list of subscribed event names (see the
// Webhook* event constants). An empty list means "all events".
type Webhook struct {
	ID             uint      `gorm:"primaryKey" json:"id"`
	OwnerExtension string    `gorm:"index;size:20;not null" json:"ownerExtension"`
	Name           string    `gorm:"size:120;not null" json:"name"`
	URL            string    `gorm:"size:512;not null" json:"url"`
	Secret         string    `gorm:"size:200" json:"-"`
	Events         string    `gorm:"type:text" json:"-"`
	Enabled        bool      `gorm:"not null;default:true" json:"enabled"`
	CreatedAt      time.Time `json:"createdAt"`
	UpdatedAt      time.Time `json:"updatedAt"`
}

func (Webhook) TableName() string { return "webhooks" }

// Canonical webhook event names. Stored in Webhook.Events and sent as the
// `event` field of every delivery payload (and the X-Webhook-Event header).
const (
	WebhookEventCallRinging     = "call.ringing"     // inbound call started / began ringing
	WebhookEventCallAnswered    = "call.answered"    // call connected
	WebhookEventCallCompleted   = "call.completed"   // call ended normally
	WebhookEventCallMissed      = "call.missed"      // no answer
	WebhookEventCallFailed      = "call.failed"      // setup/teardown failure
	WebhookEventCallUnreachable = "call.unreachable" // destination unreachable
	WebhookEventCallVoicemail   = "call.voicemail"   // caller left a voicemail
	WebhookEventCallTransferred = "call.transferred" // call transferred/forwarded
	WebhookEventCallRouted      = "call.routed"      // a routing rule redirected the call
)

// WebhookEvents is the full set of known event names, in delivery-friendly order.
var WebhookEvents = []string{
	WebhookEventCallRinging,
	WebhookEventCallAnswered,
	WebhookEventCallCompleted,
	WebhookEventCallMissed,
	WebhookEventCallFailed,
	WebhookEventCallUnreachable,
	WebhookEventCallVoicemail,
	WebhookEventCallTransferred,
	WebhookEventCallRouted,
}
