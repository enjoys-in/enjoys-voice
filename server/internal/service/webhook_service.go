package service

import (
	"context"
	"errors"
	"net/url"
	"strings"
	"time"

	"github.com/enjoys-in/enjoys-voice/api/internal/models"
	"github.com/enjoys-in/enjoys-voice/api/internal/repository"
	"gorm.io/gorm"
)

// ErrWebhookNotFound is returned when a webhook id doesn't exist (404).
var ErrWebhookNotFound = errors.New("webhook not found")

// ErrWebhookInvalid is returned when the webhook fails validation (400).
var ErrWebhookInvalid = errors.New("invalid webhook: a name and an http(s) url are required")

// WebhookInput is a partial create/update of a webhook. Only non-nil fields are
// applied. Events replaces the whole subscribed set when provided. Secret, when
// a non-empty string, overrides the stored signing secret; omit it to keep the
// existing one (a fresh one is generated on create when omitted).
type WebhookInput struct {
	Name    *string   `json:"name"`
	URL     *string   `json:"url"`
	Secret  *string   `json:"secret"`
	Events  *[]string `json:"events"`
	Enabled *bool     `json:"enabled"`
}

// WebhookView is the API view of a webhook. The signing secret is never
// returned; HasSecret reports whether one is configured.
type WebhookView struct {
	ID             uint      `json:"id"`
	OwnerExtension string    `json:"ownerExtension"`
	Name           string    `json:"name"`
	URL            string    `json:"url"`
	Events         []string  `json:"events"`
	HasSecret      bool      `json:"hasSecret"`
	Enabled        bool      `json:"enabled"`
	CreatedAt      time.Time `json:"createdAt"`
	UpdatedAt      time.Time `json:"updatedAt"`
}

// WebhookService owns CRUD over users' per-user outbound call-event webhooks.
type WebhookService interface {
	ListByOwner(ctx context.Context, owner string) ([]WebhookView, error)
	Get(ctx context.Context, id uint) (*WebhookView, error)
	Create(ctx context.Context, owner string, input *WebhookInput) (*WebhookView, error)
	Update(ctx context.Context, id uint, input *WebhookInput) (*WebhookView, error)
	Delete(ctx context.Context, id uint) error
}

type webhookService struct {
	repo repository.WebhookRepository
}

func NewWebhookService(repo repository.WebhookRepository) WebhookService {
	return &webhookService{repo: repo}
}

func (s *webhookService) ListByOwner(ctx context.Context, owner string) ([]WebhookView, error) {
	hooks, err := s.repo.ListByOwner(ctx, owner)
	if err != nil {
		return nil, err
	}
	out := make([]WebhookView, 0, len(hooks))
	for i := range hooks {
		out = append(out, toWebhookView(&hooks[i]))
	}
	return out, nil
}

func (s *webhookService) Get(ctx context.Context, id uint) (*WebhookView, error) {
	hook, err := s.repo.Get(ctx, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrWebhookNotFound
		}
		return nil, err
	}
	v := toWebhookView(hook)
	return &v, nil
}

func (s *webhookService) Create(ctx context.Context, owner string, input *WebhookInput) (*WebhookView, error) {
	// New webhooks default to enabled and get an auto-generated signing secret
	// unless the caller supplies one — every delivery is always signed.
	hook := &models.Webhook{OwnerExtension: owner, Enabled: true, Secret: "whsec_" + randomToken(24)}
	applyWebhookInput(hook, input)
	if err := validateWebhook(hook); err != nil {
		return nil, err
	}
	if err := s.repo.Create(ctx, hook); err != nil {
		return nil, err
	}
	v := toWebhookView(hook)
	return &v, nil
}

func (s *webhookService) Update(ctx context.Context, id uint, input *WebhookInput) (*WebhookView, error) {
	hook, err := s.repo.Get(ctx, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrWebhookNotFound
		}
		return nil, err
	}
	applyWebhookInput(hook, input)
	if err := validateWebhook(hook); err != nil {
		return nil, err
	}
	if err := s.repo.Update(ctx, hook); err != nil {
		return nil, err
	}
	v := toWebhookView(hook)
	return &v, nil
}

func (s *webhookService) Delete(ctx context.Context, id uint) error {
	if _, err := s.repo.Get(ctx, id); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrWebhookNotFound
		}
		return err
	}
	return s.repo.Delete(ctx, id)
}

// applyWebhookInput copies non-nil, trimmed input fields onto the webhook.
func applyWebhookInput(h *models.Webhook, input *WebhookInput) {
	if input.Name != nil {
		h.Name = strings.TrimSpace(*input.Name)
	}
	if input.URL != nil {
		h.URL = strings.TrimSpace(*input.URL)
	}
	// A non-empty secret rotates the signing key; an empty string is ignored so
	// callers don't accidentally clear it by omitting the field on update.
	if input.Secret != nil && strings.TrimSpace(*input.Secret) != "" {
		h.Secret = strings.TrimSpace(*input.Secret)
	}
	if input.Events != nil {
		h.Events = normalizeWebhookEvents(*input.Events)
	}
	if input.Enabled != nil {
		h.Enabled = *input.Enabled
	}
}

// validateWebhook checks the webhook has a name and a syntactically valid
// http(s) URL.
func validateWebhook(h *models.Webhook) error {
	if h.Name == "" || h.URL == "" {
		return ErrWebhookInvalid
	}
	u, err := url.Parse(h.URL)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return ErrWebhookInvalid
	}
	return nil
}

// normalizeWebhookEvents lowercases, de-dupes and keeps only known event names,
// preserving the canonical order. An empty/all-unknown input yields "" which the
// engine treats as "subscribe to all events".
func normalizeWebhookEvents(events []string) string {
	want := make(map[string]bool, len(events))
	for _, e := range events {
		want[strings.ToLower(strings.TrimSpace(e))] = true
	}
	kept := make([]string, 0, len(models.WebhookEvents))
	for _, known := range models.WebhookEvents {
		if want[known] {
			kept = append(kept, known)
		}
	}
	return strings.Join(kept, ",")
}

func splitWebhookEvents(csv string) []string {
	csv = strings.TrimSpace(csv)
	if csv == "" {
		// No explicit selection → the webhook receives every event.
		out := make([]string, len(models.WebhookEvents))
		copy(out, models.WebhookEvents)
		return out
	}
	parts := strings.Split(csv, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

func toWebhookView(h *models.Webhook) WebhookView {
	return WebhookView{
		ID:             h.ID,
		OwnerExtension: h.OwnerExtension,
		Name:           h.Name,
		URL:            h.URL,
		Events:         splitWebhookEvents(h.Events),
		HasSecret:      strings.TrimSpace(h.Secret) != "",
		Enabled:        h.Enabled,
		CreatedAt:      h.CreatedAt,
		UpdatedAt:      h.UpdatedAt,
	}
}
