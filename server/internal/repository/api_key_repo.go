package repository

import (
	"context"
	"time"

	"github.com/enjoys-in/enjoys-voice/api/internal/models"
	"gorm.io/gorm"
)

type apiKeyRepo struct {
	db *gorm.DB
}

func NewAPIKeyRepository(db *gorm.DB) APIKeyRepository {
	return &apiKeyRepo{db: db}
}

func (r *apiKeyRepo) ListByOwner(ctx context.Context, owner string) ([]models.APIKey, error) {
	var keys []models.APIKey
	err := r.db.WithContext(ctx).
		Where("owner_extension = ?", owner).
		Order("id asc").
		Find(&keys).Error
	return keys, err
}

func (r *apiKeyRepo) Get(ctx context.Context, id uint) (*models.APIKey, error) {
	var key models.APIKey
	if err := r.db.WithContext(ctx).First(&key, id).Error; err != nil {
		return nil, err
	}
	return &key, nil
}

func (r *apiKeyRepo) Create(ctx context.Context, key *models.APIKey) error {
	return r.db.WithContext(ctx).Create(key).Error
}

func (r *apiKeyRepo) Update(ctx context.Context, key *models.APIKey) error {
	return r.db.WithContext(ctx).Save(key).Error
}

func (r *apiKeyRepo) Delete(ctx context.Context, id uint) error {
	return r.db.WithContext(ctx).Delete(&models.APIKey{}, id).Error
}

func (r *apiKeyRepo) TouchLastUsed(ctx context.Context, id uint, at time.Time) error {
	return r.db.WithContext(ctx).Model(&models.APIKey{}).
		Where("id = ?", id).
		Update("last_used_at", at).Error
}
