package repository

import (
	"context"

	"github.com/enjoys-in/enjoys-voice/api/internal/models"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type ivrFlowRepo struct {
	db *gorm.DB
}

func NewIvrFlowRepository(db *gorm.DB) IvrFlowRepository {
	return &ivrFlowRepo{db: db}
}

func (r *ivrFlowRepo) GetAll(ctx context.Context) ([]models.IvrFlow, error) {
	var flows []models.IvrFlow
	err := r.db.WithContext(ctx).Order("updated_at DESC").Find(&flows).Error
	return flows, err
}

func (r *ivrFlowRepo) GetAllByOwner(ctx context.Context, owner string) ([]models.IvrFlow, error) {
	var flows []models.IvrFlow
	err := r.db.WithContext(ctx).Where("owner_extension = ?", owner).Order("updated_at DESC").Find(&flows).Error
	return flows, err
}

func (r *ivrFlowRepo) GetByID(ctx context.Context, id string) (*models.IvrFlow, error) {
	var flow models.IvrFlow
	if err := r.db.WithContext(ctx).Where("id = ?", id).First(&flow).Error; err != nil {
		return nil, err
	}
	return &flow, nil
}

func (r *ivrFlowRepo) GetByExtension(ctx context.Context, ext string) (*models.IvrFlow, error) {
	var flow models.IvrFlow
	if err := r.db.WithContext(ctx).Where("extension = ?", ext).First(&flow).Error; err != nil {
		return nil, err
	}
	return &flow, nil
}

func (r *ivrFlowRepo) Upsert(ctx context.Context, flow *models.IvrFlow) error {
	return r.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "id"}},
		DoUpdates: clause.AssignmentColumns([]string{"name", "extension", "enabled", "graph", "updated_at"}),
	}).Create(flow).Error
}

func (r *ivrFlowRepo) Delete(ctx context.Context, id string) error {
	return r.db.WithContext(ctx).Where("id = ?", id).Delete(&models.IvrFlow{}).Error
}
