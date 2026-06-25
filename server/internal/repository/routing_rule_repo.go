package repository

import (
	"context"

	"github.com/enjoys-in/enjoys-voice/api/internal/models"
	"gorm.io/gorm"
)

// RoutingRuleRepository persists users' per-user inbound call-routing rules.
// Every query is scoped by owner — a user only ever sees the rules they created.
type RoutingRuleRepository interface {
	ListByOwner(ctx context.Context, owner string) ([]models.RoutingRule, error)
	Get(ctx context.Context, id uint) (*models.RoutingRule, error)
	Create(ctx context.Context, rule *models.RoutingRule) error
	Update(ctx context.Context, rule *models.RoutingRule) error
	Delete(ctx context.Context, id uint) error
}

type routingRuleRepo struct {
	db *gorm.DB
}

func NewRoutingRuleRepository(db *gorm.DB) RoutingRuleRepository {
	return &routingRuleRepo{db: db}
}

func (r *routingRuleRepo) ListByOwner(ctx context.Context, owner string) ([]models.RoutingRule, error) {
	var rules []models.RoutingRule
	err := r.db.WithContext(ctx).Where("owner_extension = ?", owner).Order("created_at desc").Find(&rules).Error
	return rules, err
}

func (r *routingRuleRepo) Get(ctx context.Context, id uint) (*models.RoutingRule, error) {
	var rule models.RoutingRule
	if err := r.db.WithContext(ctx).First(&rule, id).Error; err != nil {
		return nil, err
	}
	return &rule, nil
}

func (r *routingRuleRepo) Create(ctx context.Context, rule *models.RoutingRule) error {
	return r.db.WithContext(ctx).Create(rule).Error
}

func (r *routingRuleRepo) Update(ctx context.Context, rule *models.RoutingRule) error {
	return r.db.WithContext(ctx).Save(rule).Error
}

func (r *routingRuleRepo) Delete(ctx context.Context, id uint) error {
	return r.db.WithContext(ctx).Delete(&models.RoutingRule{}, id).Error
}
