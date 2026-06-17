package models

import "time"

// UserBalance is the prepaid wallet for one extension. There is exactly one row
// per user (Extension is the primary key). The amount uses numeric(12,4) so
// money math stays exact — never float-rounded — and is always mutated together
// with a BalanceTxn ledger entry inside a single transaction, so the running
// balance is fully reconstructable from the ledger and never silently drifts.
type UserBalance struct {
	Extension string    `gorm:"primaryKey;size:32" json:"extension"`
	Currency  string    `gorm:"size:3;default:'USD'" json:"currency"`
	Balance   float64   `gorm:"type:numeric(12,4);default:0" json:"balance"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (UserBalance) TableName() string { return "user_balances" }

// BalanceTxn is one immutable entry in the wallet ledger. Amount is signed:
// positive for credits (top-ups, adjustments) and negative for debits
// (per-call charges). Call debits carry the originating CallID so a debit can be
// applied at most once per call — the writer checks for an existing (CallID,
// Reason='call') row before inserting, making end-of-call billing idempotent
// across queue retries.
type BalanceTxn struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	Extension string    `gorm:"size:32;index" json:"extension"`
	Amount    float64   `gorm:"type:numeric(12,4)" json:"amount"`
	Currency  string    `gorm:"size:3" json:"currency"`
	Reason    string    `gorm:"size:40" json:"reason"`
	CallID    string    `gorm:"size:128;index" json:"call_id"`
	CreatedAt time.Time `json:"created_at"`
}

func (BalanceTxn) TableName() string { return "balance_txns" }

// BalanceResponse is the API view of a wallet, including whether prepaid billing
// is enabled at all (the frontend hides the wallet UI when it is off).
type BalanceResponse struct {
	Extension string    `json:"extension"`
	Balance   float64   `json:"balance"`
	Currency  string    `json:"currency"`
	Enabled   bool      `json:"enabled"`
	UpdatedAt time.Time `json:"updated_at"`
}

// BalanceTxnResponse is the API view of one ledger entry.
type BalanceTxnResponse struct {
	ID        uint      `json:"id"`
	Amount    float64   `json:"amount"`
	Currency  string    `json:"currency"`
	Reason    string    `json:"reason"`
	CallID    string    `json:"call_id"`
	CreatedAt time.Time `json:"created_at"`
}

func (b *UserBalance) ToResponse(enabled bool) BalanceResponse {
	return BalanceResponse{
		Extension: b.Extension,
		Balance:   b.Balance,
		Currency:  b.Currency,
		Enabled:   enabled,
		UpdatedAt: b.UpdatedAt,
	}
}

func (t *BalanceTxn) ToResponse() BalanceTxnResponse {
	return BalanceTxnResponse{
		ID:        t.ID,
		Amount:    t.Amount,
		Currency:  t.Currency,
		Reason:    t.Reason,
		CallID:    t.CallID,
		CreatedAt: t.CreatedAt,
	}
}
