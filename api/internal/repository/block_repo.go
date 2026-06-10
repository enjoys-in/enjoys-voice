package repository

import (
	"context"

	"github.com/enjoys-in/enjoys-voice/api/internal/models"
	"gorm.io/gorm"
)

type blockRepo struct {
	db *gorm.DB
}

func NewBlockRepository(db *gorm.DB) BlockRepository {
	return &blockRepo{db: db}
}

func (r *blockRepo) GetByExtension(ctx context.Context, ext string) ([]string, error) {
	var numbers []string
	err := r.db.WithContext(ctx).
		Model(&models.BlockedNumber{}).
		Where("extension = ?", ext).
		Pluck("number", &numbers).Error
	return numbers, err
}

func (r *blockRepo) Add(ctx context.Context, block *models.BlockedNumber) error {
	return r.db.WithContext(ctx).Create(block).Error
}

func (r *blockRepo) Remove(ctx context.Context, ext string, number string) error {
	return r.db.WithContext(ctx).
		Where("extension = ? AND number = ?", ext, number).
		Delete(&models.BlockedNumber{}).Error
}

func (r *blockRepo) DeleteAll(ctx context.Context, ext string) error {
	return r.db.WithContext(ctx).Where("extension = ?", ext).Delete(&models.BlockedNumber{}).Error
}
