package repository

import (
	"context"

	"github.com/enjoys-in/enjoys-voice/api/internal/models"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type forwardingRepo struct {
	db *gorm.DB
}

func NewForwardingRepository(db *gorm.DB) ForwardingRepository {
	return &forwardingRepo{db: db}
}

func (r *forwardingRepo) Get(ctx context.Context, ext string) (*models.ForwardingResponse, error) {
	var rules []models.ForwardingRule
	err := r.db.WithContext(ctx).Where("extension = ?", ext).Find(&rules).Error
	if err != nil {
		return nil, err
	}

	resp := &models.ForwardingResponse{}
	for _, rule := range rules {
		target := rule.Target
		switch rule.Type {
		case "busy":
			resp.Busy = &target
		case "noAnswer":
			resp.NoAnswer = &target
		case "unavailable":
			resp.Unavailable = &target
		}
	}
	return resp, nil
}

func (r *forwardingRepo) Set(ctx context.Context, rule *models.ForwardingRule) error {
	if rule.Target == "" {
		// Remove the rule
		return r.db.WithContext(ctx).
			Where("extension = ? AND type = ?", rule.Extension, rule.Type).
			Delete(&models.ForwardingRule{}).Error
	}
	return r.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "extension"}, {Name: "type"}},
		DoUpdates: clause.AssignmentColumns([]string{"target", "updated_at"}),
	}).Create(rule).Error
}

func (r *forwardingRepo) DeleteAll(ctx context.Context, ext string) error {
	return r.db.WithContext(ctx).Where("extension = ?", ext).Delete(&models.ForwardingRule{}).Error
}
