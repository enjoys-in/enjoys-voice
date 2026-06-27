package service

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/enjoys-in/enjoys-voice/api/internal/models"
	"github.com/enjoys-in/enjoys-voice/api/internal/repository"
	"gorm.io/gorm"
)

// ErrRoutingRuleNotFound is returned when a rule id doesn't exist (404).
var ErrRoutingRuleNotFound = errors.New("routing rule not found")

// ErrRoutingRuleInvalid is returned when the rule fails validation (400).
var ErrRoutingRuleInvalid = errors.New("invalid routing rule: check match and destination")

// RoutingRuleInput is a partial create/update of a routing rule. Only non-nil
// fields are applied.
type RoutingRuleInput struct {
	MatchType        *string `json:"matchType"`
	MatchNumber      *string `json:"matchNumber"`
	DestinationType  *string `json:"destinationType"`
	DestinationValue *string `json:"destinationValue"`
	Enabled          *bool   `json:"enabled"`
}

// RoutingRuleView is the API view of a routing rule.
type RoutingRuleView struct {
	ID               uint      `json:"id"`
	OwnerExtension   string    `json:"ownerExtension"`
	MatchType        string    `json:"matchType"`
	MatchNumber      string    `json:"matchNumber,omitempty"`
	DestinationType  string    `json:"destinationType"`
	DestinationValue string    `json:"destinationValue,omitempty"`
	Enabled          bool      `json:"enabled"`
	CreatedAt        time.Time `json:"createdAt"`
	UpdatedAt        time.Time `json:"updatedAt"`
}

// RoutingRuleService owns CRUD over users' per-user inbound routing rules.
type RoutingRuleService interface {
	ListByOwner(ctx context.Context, owner string) ([]RoutingRuleView, error)
	Get(ctx context.Context, id uint) (*RoutingRuleView, error)
	Create(ctx context.Context, owner string, input *RoutingRuleInput) (*RoutingRuleView, error)
	Update(ctx context.Context, id uint, input *RoutingRuleInput) (*RoutingRuleView, error)
	Delete(ctx context.Context, id uint) error
}

type routingRuleService struct {
	repo repository.RoutingRuleRepository
}

func NewRoutingRuleService(repo repository.RoutingRuleRepository) RoutingRuleService {
	return &routingRuleService{repo: repo}
}

func (s *routingRuleService) ListByOwner(ctx context.Context, owner string) ([]RoutingRuleView, error) {
	rules, err := s.repo.ListByOwner(ctx, owner)
	if err != nil {
		return nil, err
	}
	out := make([]RoutingRuleView, 0, len(rules))
	for i := range rules {
		out = append(out, toRoutingRuleView(&rules[i]))
	}
	return out, nil
}

func (s *routingRuleService) Get(ctx context.Context, id uint) (*RoutingRuleView, error) {
	rule, err := s.repo.Get(ctx, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrRoutingRuleNotFound
		}
		return nil, err
	}
	v := toRoutingRuleView(rule)
	return &v, nil
}

func (s *routingRuleService) Create(ctx context.Context, owner string, input *RoutingRuleInput) (*RoutingRuleView, error) {
	// New rules default to enabled unless the caller explicitly disables them.
	rule := &models.RoutingRule{OwnerExtension: owner, MatchType: "all", Enabled: true}
	applyRoutingRuleInput(rule, input)
	if err := validateRoutingRule(rule); err != nil {
		return nil, err
	}
	if err := s.repo.Create(ctx, rule); err != nil {
		return nil, err
	}
	v := toRoutingRuleView(rule)
	return &v, nil
}

func (s *routingRuleService) Update(ctx context.Context, id uint, input *RoutingRuleInput) (*RoutingRuleView, error) {
	rule, err := s.repo.Get(ctx, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrRoutingRuleNotFound
		}
		return nil, err
	}
	applyRoutingRuleInput(rule, input)
	if err := validateRoutingRule(rule); err != nil {
		return nil, err
	}
	if err := s.repo.Update(ctx, rule); err != nil {
		return nil, err
	}
	v := toRoutingRuleView(rule)
	return &v, nil
}

func (s *routingRuleService) Delete(ctx context.Context, id uint) error {
	if _, err := s.repo.Get(ctx, id); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrRoutingRuleNotFound
		}
		return err
	}
	return s.repo.Delete(ctx, id)
}

// applyRoutingRuleInput copies non-nil, trimmed input fields onto the rule.
func applyRoutingRuleInput(r *models.RoutingRule, input *RoutingRuleInput) {
	if input.MatchType != nil {
		r.MatchType = strings.ToLower(strings.TrimSpace(*input.MatchType))
	}
	if input.MatchNumber != nil {
		r.MatchNumber = strings.TrimSpace(*input.MatchNumber)
	}
	if input.DestinationType != nil {
		r.DestinationType = strings.ToLower(strings.TrimSpace(*input.DestinationType))
	}
	if input.DestinationValue != nil {
		r.DestinationValue = strings.TrimSpace(*input.DestinationValue)
	}
	if input.Enabled != nil {
		r.Enabled = *input.Enabled
	}
}

// validateRoutingRule normalizes and checks a rule's match + destination,
// blanking fields that don't apply to the chosen type.
func validateRoutingRule(r *models.RoutingRule) error {
	switch r.MatchType {
	case "all":
		r.MatchNumber = ""
	case "number":
		if r.MatchNumber == "" {
			return ErrRoutingRuleInvalid
		}
	default:
		return ErrRoutingRuleInvalid
	}

	switch r.DestinationType {
	case "ivr", "extension", "pstn":
		if r.DestinationValue == "" {
			return ErrRoutingRuleInvalid
		}
	case "ai_agent":
		// DestinationValue is the id of an AI agent the owner configured. The
		// Node runtime resolves it to a live speech→LLM→speech pipeline.
		if r.DestinationValue == "" {
			return ErrRoutingRuleInvalid
		}
	case "voicemail":
		r.DestinationValue = ""
	default:
		return ErrRoutingRuleInvalid
	}
	return nil
}

func toRoutingRuleView(r *models.RoutingRule) RoutingRuleView {
	return RoutingRuleView{
		ID:               r.ID,
		OwnerExtension:   r.OwnerExtension,
		MatchType:        r.MatchType,
		MatchNumber:      r.MatchNumber,
		DestinationType:  r.DestinationType,
		DestinationValue: r.DestinationValue,
		Enabled:          r.Enabled,
		CreatedAt:        r.CreatedAt,
		UpdatedAt:        r.UpdatedAt,
	}
}
