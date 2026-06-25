package repository

import (
	"context"

	"github.com/enjoys-in/enjoys-voice/api/internal/models"
	"gorm.io/gorm"
)

type scheduleRepo struct {
	db *gorm.DB
}

func NewScheduleRepository(db *gorm.DB) ScheduleRepository {
	return &scheduleRepo{db: db}
}

// GetBusinessHours returns the single global policy with its windows, or
// (nil, nil) when none has been configured yet.
func (r *scheduleRepo) GetBusinessHours(ctx context.Context) (*models.BusinessHoursPolicy, error) {
	var policy models.BusinessHoursPolicy
	err := r.db.WithContext(ctx).
		Preload("Windows", func(db *gorm.DB) *gorm.DB {
			return db.Order("day_of_week ASC, start_minute ASC")
		}).
		Order("id ASC").
		First(&policy).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, err
	}
	return &policy, nil
}

// SaveBusinessHours upserts the single policy row and fully replaces its window
// set, atomically. Returns the reloaded policy with windows.
func (r *scheduleRepo) SaveBusinessHours(ctx context.Context, timezone string, enabled bool, windows []models.BusinessHoursWindow) (*models.BusinessHoursPolicy, error) {
	var policy models.BusinessHoursPolicy
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// At most one policy row exists; find it or create a fresh one.
		first := tx.Order("id ASC").First(&policy)
		if first.Error != nil {
			if first.Error != gorm.ErrRecordNotFound {
				return first.Error
			}
			policy = models.BusinessHoursPolicy{Timezone: timezone, Enabled: enabled}
			if err := tx.Create(&policy).Error; err != nil {
				return err
			}
		} else {
			policy.Timezone = timezone
			policy.Enabled = enabled
			if err := tx.Model(&policy).Updates(map[string]interface{}{
				"timezone": timezone,
				"enabled":  enabled,
			}).Error; err != nil {
				return err
			}
		}

		// Replace the window set wholesale.
		if err := tx.Where("policy_id = ?", policy.ID).Delete(&models.BusinessHoursWindow{}).Error; err != nil {
			return err
		}
		if len(windows) > 0 {
			for i := range windows {
				windows[i].ID = 0
				windows[i].PolicyID = policy.ID
			}
			if err := tx.Create(&windows).Error; err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return r.GetBusinessHours(ctx)
}

// ListAvailability returns a single extension's windows, ordered for display.
func (r *scheduleRepo) ListAvailability(ctx context.Context, ext string) ([]models.UserAvailabilityWindow, error) {
	var windows []models.UserAvailabilityWindow
	err := r.db.WithContext(ctx).
		Where("extension = ?", ext).
		Order("day_of_week ASC, start_minute ASC").
		Find(&windows).Error
	if err != nil {
		return nil, err
	}
	return windows, nil
}

// ReplaceAvailability swaps an extension's entire window set in one transaction.
func (r *scheduleRepo) ReplaceAvailability(ctx context.Context, ext string, windows []models.UserAvailabilityWindow) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("extension = ?", ext).Delete(&models.UserAvailabilityWindow{}).Error; err != nil {
			return err
		}
		if len(windows) == 0 {
			return nil
		}
		for i := range windows {
			windows[i].ID = 0
			windows[i].Extension = ext
		}
		return tx.Create(&windows).Error
	})
}
