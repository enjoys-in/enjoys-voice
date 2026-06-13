package repository

import (
	"context"

	"github.com/enjoys-in/enjoys-voice/api/internal/models"
	"gorm.io/gorm"
)

type auditRepo struct {
	db *gorm.DB
}

func NewAuditRepository(db *gorm.DB) AuditRepository {
	return &auditRepo{db: db}
}

func (r *auditRepo) Create(ctx context.Context, log *models.AuditLog) error {
	return r.db.WithContext(ctx).Create(log).Error
}

func (r *auditRepo) Query(ctx context.Context, q AuditQuery) ([]models.AuditLog, error) {
	tx := r.db.WithContext(ctx).Model(&models.AuditLog{})

	if q.Extension != "" {
		tx = tx.Where("extension = ?", q.Extension)
	}
	if q.Event != "" {
		tx = tx.Where("event = ?", q.Event)
	}
	if q.From != nil {
		tx = tx.Where("created_at >= ?", *q.From)
	}
	if q.To != nil {
		tx = tx.Where("created_at <= ?", *q.To)
	}

	limit := q.Limit
	if limit <= 0 || limit > 500 {
		limit = 100
	}

	var logs []models.AuditLog
	err := tx.Order("created_at DESC").Limit(limit).Find(&logs).Error
	return logs, err
}

func (r *auditRepo) GetByExtension(ctx context.Context, ext string, limit int) ([]models.AuditLog, error) {
	return r.Query(ctx, AuditQuery{Extension: ext, Limit: limit})
}
