package service

import (
	"context"
	"math"

	"github.com/enjoys-in/enjoys-voice/api/internal/models"
	"github.com/enjoys-in/enjoys-voice/api/internal/repository"
)

type balanceService struct {
	repo     repository.BalanceRepository
	currency string
	enabled  bool
}

// NewBalanceService builds the prepaid wallet service. currency is the single
// workspace currency (BILLING_CURRENCY) stamped on new wallets and top-ups;
// enabled mirrors BILLING_PREPAID_ENABLED so the API can advertise whether the
// wallet UI should show and reject top-ups when billing is off.
func NewBalanceService(repo repository.BalanceRepository, currency string, enabled bool) BalanceService {
	if currency == "" {
		currency = "USD"
	}
	return &balanceService{repo: repo, currency: currency, enabled: enabled}
}

func (s *balanceService) Enabled() bool { return s.enabled }

func (s *balanceService) Get(ctx context.Context, ext string) (*models.UserBalance, error) {
	bal, err := s.repo.Get(ctx, ext)
	if err != nil {
		return nil, err
	}
	if bal.Currency == "" {
		bal.Currency = s.currency
	}
	return bal, nil
}

func (s *balanceService) TopUp(ctx context.Context, ext string, amount float64, reason string) (*models.UserBalance, error) {
	if !s.enabled {
		return nil, ErrBalanceDisabled
	}
	// Round to the wallet's 4-decimal precision so float input can't smuggle in
	// sub-precision drift.
	amount = math.Round(amount*10000) / 10000
	if amount <= 0 {
		return nil, ErrBalanceAmount
	}
	if reason == "" {
		reason = "topup"
	}
	return s.repo.Credit(ctx, ext, amount, s.currency, reason, "")
}

func (s *balanceService) ListTxns(ctx context.Context, ext string, limit int) ([]models.BalanceTxn, error) {
	return s.repo.ListTxns(ctx, ext, limit)
}
