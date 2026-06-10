package repository

import (
	"context"

	"github.com/enjoys-in/enjoys-voice/api/internal/models"
	"gorm.io/gorm"
)

type callRepo struct {
	db *gorm.DB
}

func NewCallRepository(db *gorm.DB) CallRepository {
	return &callRepo{db: db}
}

func (r *callRepo) Create(ctx context.Context, call *models.CallRecord) error {
	return r.db.WithContext(ctx).Create(call).Error
}

func (r *callRepo) GetAll(ctx context.Context) ([]models.CallRecord, error) {
	var calls []models.CallRecord
	err := r.db.WithContext(ctx).Order("started_at DESC").Limit(200).Find(&calls).Error
	return calls, err
}

func (r *callRepo) GetByExtension(ctx context.Context, ext string) ([]models.CallRecord, error) {
	var calls []models.CallRecord
	err := r.db.WithContext(ctx).
		Where(`"from" = ? OR "to" = ?`, ext, ext).
		Order("started_at DESC").
		Limit(100).
		Find(&calls).Error
	return calls, err
}
