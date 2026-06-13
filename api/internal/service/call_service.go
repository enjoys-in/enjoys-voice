package service

import (
	"context"

	"github.com/enjoys-in/enjoys-voice/api/internal/models"
	"github.com/enjoys-in/enjoys-voice/api/internal/repository"
)

type callService struct {
	callRepo repository.CallRepository
}

func NewCallService(cr repository.CallRepository) CallService {
	return &callService{callRepo: cr}
}

func (s *callService) GetAll(ctx context.Context) ([]models.CallRecord, error) {
	return s.callRepo.GetAll(ctx)
}

func (s *callService) GetByExtension(ctx context.Context, ext string) ([]models.CallRecord, error) {
	return s.callRepo.GetByExtension(ctx, ext)
}

func (s *callService) Create(ctx context.Context, call *models.CallRecord) error {
	return s.callRepo.Create(ctx, call)
}

func (s *callService) DeleteByExtension(ctx context.Context, ext string) (int64, error) {
	return s.callRepo.DeleteByExtension(ctx, ext)
}
