package service

import (
	"context"
	"errors"
	"strings"

	"github.com/enjoys-in/enjoys-voice/api/internal/models"
	"github.com/enjoys-in/enjoys-voice/api/internal/repository"
)

type rateService struct {
	repo repository.RateRepository
}

func NewRateService(repo repository.RateRepository) RateService {
	return &rateService{repo: repo}
}

// ─── Rate plans ──────────────────────────────────────────

func (s *rateService) ListPlans(ctx context.Context) ([]models.RatePlanResponse, error) {
	plans, err := s.repo.ListPlans(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]models.RatePlanResponse, 0, len(plans))
	for i := range plans {
		count, _ := s.repo.CountRates(ctx, plans[i].ID)
		out = append(out, plans[i].ToResponse(count))
	}
	return out, nil
}

func (s *rateService) GetPlan(ctx context.Context, id uint) (*RatePlanDetail, error) {
	plan, err := s.repo.GetPlan(ctx, id)
	if err != nil {
		return nil, err
	}
	rates, err := s.repo.ListRates(ctx, id)
	if err != nil {
		return nil, err
	}
	rateResponses := make([]models.RateResponse, 0, len(rates))
	for i := range rates {
		rateResponses = append(rateResponses, rates[i].ToResponse())
	}
	return &RatePlanDetail{
		RatePlanResponse: plan.ToResponse(int64(len(rates))),
		Rates:            rateResponses,
	}, nil
}

func (s *rateService) CreatePlan(ctx context.Context, input *RatePlanInput) (*models.RatePlanResponse, error) {
	if input.Name == nil || strings.TrimSpace(*input.Name) == "" {
		return nil, errors.New("name is required")
	}
	plan := &models.RatePlan{
		Name:     strings.TrimSpace(*input.Name),
		Currency: "USD",
	}
	if input.Currency != nil && strings.TrimSpace(*input.Currency) != "" {
		plan.Currency = strings.ToUpper(strings.TrimSpace(*input.Currency))
	}
	if input.Default != nil {
		plan.Default = *input.Default
	}
	// Only one plan may be the default — clear the others first.
	if plan.Default {
		if err := s.repo.ClearDefault(ctx); err != nil {
			return nil, err
		}
	}
	if err := s.repo.CreatePlan(ctx, plan); err != nil {
		return nil, err
	}
	resp := plan.ToResponse(0)
	return &resp, nil
}

func (s *rateService) UpdatePlan(ctx context.Context, id uint, input *RatePlanInput) (*models.RatePlanResponse, error) {
	plan, err := s.repo.GetPlan(ctx, id)
	if err != nil {
		return nil, err
	}
	if input.Name != nil && strings.TrimSpace(*input.Name) != "" {
		plan.Name = strings.TrimSpace(*input.Name)
	}
	if input.Currency != nil && strings.TrimSpace(*input.Currency) != "" {
		plan.Currency = strings.ToUpper(strings.TrimSpace(*input.Currency))
	}
	if input.Default != nil {
		// Clear the previous default before promoting this plan.
		if *input.Default && !plan.Default {
			if err := s.repo.ClearDefault(ctx); err != nil {
				return nil, err
			}
		}
		plan.Default = *input.Default
	}
	if err := s.repo.UpdatePlan(ctx, plan); err != nil {
		return nil, err
	}
	count, _ := s.repo.CountRates(ctx, plan.ID)
	resp := plan.ToResponse(count)
	return &resp, nil
}

func (s *rateService) DeletePlan(ctx context.Context, id uint) error {
	return s.repo.DeletePlan(ctx, id)
}

// ─── Rates ───────────────────────────────────────────────

func (s *rateService) ListRates(ctx context.Context, planID uint) ([]models.RateResponse, error) {
	rates, err := s.repo.ListRates(ctx, planID)
	if err != nil {
		return nil, err
	}
	out := make([]models.RateResponse, 0, len(rates))
	for i := range rates {
		out = append(out, rates[i].ToResponse())
	}
	return out, nil
}

func (s *rateService) CreateRate(ctx context.Context, planID uint, input *RateInput) (*models.RateResponse, error) {
	if input.Prefix == nil || strings.TrimSpace(*input.Prefix) == "" {
		return nil, errors.New("prefix is required")
	}
	// Make sure the parent plan exists so we don't create dangling rates.
	if _, err := s.repo.GetPlan(ctx, planID); err != nil {
		return nil, err
	}
	rate := &models.Rate{
		RatePlanID:    planID,
		Prefix:        normalizePrefix(*input.Prefix),
		IncrementSecs: 60,
	}
	applyRateInput(rate, input)
	if err := s.repo.CreateRate(ctx, rate); err != nil {
		return nil, err
	}
	resp := rate.ToResponse()
	return &resp, nil
}

func (s *rateService) UpdateRate(ctx context.Context, id uint, input *RateInput) (*models.RateResponse, error) {
	rate, err := s.repo.GetRate(ctx, id)
	if err != nil {
		return nil, err
	}
	applyRateInput(rate, input)
	if err := s.repo.UpdateRate(ctx, rate); err != nil {
		return nil, err
	}
	resp := rate.ToResponse()
	return &resp, nil
}

func (s *rateService) DeleteRate(ctx context.Context, id uint) error {
	return s.repo.DeleteRate(ctx, id)
}

// applyRateInput copies the provided (non-nil) fields onto a rate.
func applyRateInput(rate *models.Rate, input *RateInput) {
	if input.Prefix != nil && strings.TrimSpace(*input.Prefix) != "" {
		rate.Prefix = normalizePrefix(*input.Prefix)
	}
	if input.Description != nil {
		rate.Description = strings.TrimSpace(*input.Description)
	}
	if input.SellPerMin != nil {
		rate.SellPerMin = *input.SellPerMin
	}
	if input.BuyPerMin != nil {
		rate.BuyPerMin = *input.BuyPerMin
	}
	if input.SetupFee != nil {
		rate.SetupFee = *input.SetupFee
	}
	if input.IncrementSecs != nil && *input.IncrementSecs > 0 {
		rate.IncrementSecs = *input.IncrementSecs
	}
	if input.MinSecs != nil && *input.MinSecs >= 0 {
		rate.MinSecs = *input.MinSecs
	}
}

// normalizePrefix strips anything but digits so prefixes match the E.164 digits
// the dialer produces (no `+`, spaces, or dashes).
func normalizePrefix(prefix string) string {
	var b strings.Builder
	for _, r := range prefix {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	return b.String()
}
