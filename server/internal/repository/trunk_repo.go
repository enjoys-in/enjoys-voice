package repository

import (
	"context"
	"time"

	"github.com/enjoys-in/enjoys-voice/api/internal/models"
	"gorm.io/gorm"
)

type trunkRepo struct {
	db *gorm.DB
}

func NewTrunkRepository(db *gorm.DB) TrunkRepository {
	return &trunkRepo{db: db}
}

func (r *trunkRepo) List(ctx context.Context) ([]models.Trunk, error) {
	var trunks []models.Trunk
	err := r.db.WithContext(ctx).Order("id asc").Find(&trunks).Error
	return trunks, err
}

func (r *trunkRepo) Get(ctx context.Context, id uint) (*models.Trunk, error) {
	var trunk models.Trunk
	if err := r.db.WithContext(ctx).First(&trunk, id).Error; err != nil {
		return nil, err
	}
	return &trunk, nil
}

func (r *trunkRepo) Create(ctx context.Context, trunk *models.Trunk) error {
	return r.db.WithContext(ctx).Create(trunk).Error
}

func (r *trunkRepo) Update(ctx context.Context, trunk *models.Trunk) error {
	return r.db.WithContext(ctx).Save(trunk).Error
}

func (r *trunkRepo) Delete(ctx context.Context, id uint) error {
	return r.db.WithContext(ctx).Delete(&models.Trunk{}, id).Error
}

func (r *trunkRepo) SetStatus(ctx context.Context, id uint, status string, testedAt time.Time) error {
	return r.db.WithContext(ctx).Model(&models.Trunk{}).
		Where("id = ?", id).
		Updates(map[string]any{"last_status": status, "last_tested_at": testedAt}).Error
}
