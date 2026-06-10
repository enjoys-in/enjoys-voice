package repository

import (
	"context"

	"github.com/enjoys-in/enjoys-voice/api/internal/models"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type settingsRepo struct {
	db *gorm.DB
}

func NewSettingsRepository(db *gorm.DB) SettingsRepository {
	return &settingsRepo{db: db}
}

func (r *settingsRepo) Get(ctx context.Context, ext string) (*models.UserSettings, error) {
	var s models.UserSettings
	err := r.db.WithContext(ctx).Where("extension = ?", ext).First(&s).Error
	if err != nil {
		return nil, err
	}
	return &s, nil
}

func (r *settingsRepo) Upsert(ctx context.Context, settings *models.UserSettings) error {
	return r.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "user_id"}},
		DoUpdates: clause.AssignmentColumns([]string{
			"sounds_enabled", "dtmf_enabled", "caller_tune", "ringtone",
			"pstn_enabled", "pstn_mobile", "pstn_country_code",
			"recording_enabled", "voicemail_enabled", "updated_at",
		}),
	}).Create(settings).Error
}

func (r *settingsRepo) Delete(ctx context.Context, ext string) error {
	return r.db.WithContext(ctx).Where("extension = ?", ext).Delete(&models.UserSettings{}).Error
}
