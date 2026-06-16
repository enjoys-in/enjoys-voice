package repository

import (
	"context"

	"github.com/enjoys-in/enjoys-voice/api/internal/models"
	"gorm.io/gorm"
)

type systemSettingsRepo struct {
	db *gorm.DB
}

func NewSystemSettingsRepository(db *gorm.DB) SystemSettingsRepository {
	return &systemSettingsRepo{db: db}
}

// Get returns the singleton settings row, creating it with model defaults on
// first access so callers never have to deal with a missing record.
func (r *systemSettingsRepo) Get(ctx context.Context) (*models.SystemSettings, error) {
	var s models.SystemSettings
	err := r.db.WithContext(ctx).
		Where("id = ?", models.SystemSettingsID).
		Attrs(models.SystemSettings{
			BrandName:    "Enjoys Voice",
			AccentColor:  "#6366f1",
			AllowUserDND: true,
		}).
		FirstOrCreate(&s, models.SystemSettings{ID: models.SystemSettingsID}).Error
	if err != nil {
		return nil, err
	}
	return &s, nil
}

// Save persists the singleton row. ID is pinned so Save always targets the one
// canonical record (Updates by struct skips zero-values, so the service loads
// then mutates the full row before calling Save).
func (r *systemSettingsRepo) Save(ctx context.Context, s *models.SystemSettings) error {
	s.ID = models.SystemSettingsID
	return r.db.WithContext(ctx).Save(s).Error
}
