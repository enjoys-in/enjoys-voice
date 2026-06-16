package repository

import (
	"context"

	"github.com/enjoys-in/enjoys-voice/api/internal/models"
	"gorm.io/gorm"
)

type rateRepo struct {
	db *gorm.DB
}

func NewRateRepository(db *gorm.DB) RateRepository {
	return &rateRepo{db: db}
}

// ─── Rate plans ──────────────────────────────────────────

func (r *rateRepo) ListPlans(ctx context.Context) ([]models.RatePlan, error) {
	var plans []models.RatePlan
	err := r.db.WithContext(ctx).Order("name asc").Find(&plans).Error
	return plans, err
}

func (r *rateRepo) GetPlan(ctx context.Context, id uint) (*models.RatePlan, error) {
	var plan models.RatePlan
	if err := r.db.WithContext(ctx).First(&plan, id).Error; err != nil {
		return nil, err
	}
	return &plan, nil
}

func (r *rateRepo) CreatePlan(ctx context.Context, plan *models.RatePlan) error {
	return r.db.WithContext(ctx).Create(plan).Error
}

func (r *rateRepo) UpdatePlan(ctx context.Context, plan *models.RatePlan) error {
	return r.db.WithContext(ctx).Save(plan).Error
}

// DeletePlan removes the plan and all of its rates in one transaction so no
// orphan rates are left behind.
func (r *rateRepo) DeletePlan(ctx context.Context, id uint) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("rate_plan_id = ?", id).Delete(&models.Rate{}).Error; err != nil {
			return err
		}
		return tx.Delete(&models.RatePlan{}, id).Error
	})
}

// ClearDefault unsets the Default flag on every plan so a single new default can
// be set. Callers run this before flagging the chosen plan.
func (r *rateRepo) ClearDefault(ctx context.Context) error {
	return r.db.WithContext(ctx).
		Model(&models.RatePlan{}).
		Where("is_default = ?", true).
		Update("is_default", false).Error
}

func (r *rateRepo) CountRates(ctx context.Context, planID uint) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).
		Model(&models.Rate{}).
		Where("rate_plan_id = ?", planID).
		Count(&count).Error
	return count, err
}

// ─── Rates ───────────────────────────────────────────────

// ListRates returns a plan's rates longest-prefix first (then alphabetically),
// so a prefix matcher can stop at the first leading match.
func (r *rateRepo) ListRates(ctx context.Context, planID uint) ([]models.Rate, error) {
	var rates []models.Rate
	err := r.db.WithContext(ctx).
		Where("rate_plan_id = ?", planID).
		Order("length(prefix) desc, prefix asc").
		Find(&rates).Error
	return rates, err
}

func (r *rateRepo) GetRate(ctx context.Context, id uint) (*models.Rate, error) {
	var rate models.Rate
	if err := r.db.WithContext(ctx).First(&rate, id).Error; err != nil {
		return nil, err
	}
	return &rate, nil
}

func (r *rateRepo) CreateRate(ctx context.Context, rate *models.Rate) error {
	return r.db.WithContext(ctx).Create(rate).Error
}

func (r *rateRepo) UpdateRate(ctx context.Context, rate *models.Rate) error {
	return r.db.WithContext(ctx).Save(rate).Error
}

func (r *rateRepo) DeleteRate(ctx context.Context, id uint) error {
	return r.db.WithContext(ctx).Delete(&models.Rate{}, id).Error
}
