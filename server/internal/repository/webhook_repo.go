package repository

import (
	"context"

	"github.com/enjoys-in/enjoys-voice/api/internal/models"
	"gorm.io/gorm"
)

// WebhookRepository persists users' per-user outbound call-event webhooks.
// Every query is scoped by owner — a user only ever sees the webhooks they
// created.
type WebhookRepository interface {
	ListByOwner(ctx context.Context, owner string) ([]models.Webhook, error)
	Get(ctx context.Context, id uint) (*models.Webhook, error)
	Create(ctx context.Context, hook *models.Webhook) error
	Update(ctx context.Context, hook *models.Webhook) error
	Delete(ctx context.Context, id uint) error
}

type webhookRepo struct {
	db *gorm.DB
}

func NewWebhookRepository(db *gorm.DB) WebhookRepository {
	return &webhookRepo{db: db}
}

func (r *webhookRepo) ListByOwner(ctx context.Context, owner string) ([]models.Webhook, error) {
	var hooks []models.Webhook
	err := r.db.WithContext(ctx).Where("owner_extension = ?", owner).Order("created_at desc").Find(&hooks).Error
	return hooks, err
}

func (r *webhookRepo) Get(ctx context.Context, id uint) (*models.Webhook, error) {
	var hook models.Webhook
	if err := r.db.WithContext(ctx).First(&hook, id).Error; err != nil {
		return nil, err
	}
	return &hook, nil
}

func (r *webhookRepo) Create(ctx context.Context, hook *models.Webhook) error {
	return r.db.WithContext(ctx).Create(hook).Error
}

func (r *webhookRepo) Update(ctx context.Context, hook *models.Webhook) error {
	return r.db.WithContext(ctx).Save(hook).Error
}

func (r *webhookRepo) Delete(ctx context.Context, id uint) error {
	return r.db.WithContext(ctx).Delete(&models.Webhook{}, id).Error
}
