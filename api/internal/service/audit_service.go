package service

import (
	"context"

	"github.com/enjoys-in/enjoys-voice/api/internal/models"
	"github.com/enjoys-in/enjoys-voice/api/internal/repository"
)

type auditService struct {
	repo repository.AuditRepository
}

func NewAuditService(r repository.AuditRepository) AuditService {
	return &auditService{repo: r}
}

func (s *auditService) Query(ctx context.Context, q repository.AuditQuery) ([]models.AuditLog, error) {
	return s.repo.Query(ctx, q)
}

func (s *auditService) GetByExtension(ctx context.Context, ext string, limit int) ([]models.AuditLog, error) {
	return s.repo.GetByExtension(ctx, ext, limit)
}

func (s *auditService) Record(ctx context.Context, ext, event, detail string) error {
	return s.repo.Create(ctx, &models.AuditLog{
		Extension: ext,
		Event:     event,
		Detail:    detail,
	})
}
