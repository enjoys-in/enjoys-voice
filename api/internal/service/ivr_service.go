package service

import (
	"context"

	"github.com/enjoys-in/enjoys-voice/api/internal/cache"
	"github.com/enjoys-in/enjoys-voice/api/internal/models"
	"github.com/enjoys-in/enjoys-voice/api/internal/repository"
)

type ivrService struct {
	repo  repository.IvrFlowRepository
	cache cache.Cache
}

func NewIvrService(r repository.IvrFlowRepository, c cache.Cache) IvrService {
	return &ivrService{repo: r, cache: c}
}

func (s *ivrService) List(ctx context.Context) ([]models.IvrFlow, error) {
	return s.repo.GetAll(ctx)
}

func (s *ivrService) Get(ctx context.Context, id string) (*models.IvrFlow, error) {
	return s.repo.GetByID(ctx, id)
}

func (s *ivrService) Save(ctx context.Context, flow *models.IvrFlow) error {
	if err := s.repo.Upsert(ctx, flow); err != nil {
		return err
	}
	// Invalidate the per-extension cache so the SIP layer reloads the graph.
	if flow.Extension != "" {
		_ = s.cache.Del(ctx, cache.IvrKey(flow.Extension))
	}
	return nil
}

func (s *ivrService) Delete(ctx context.Context, id string) error {
	// Best-effort cache cleanup keyed by extension.
	if flow, err := s.repo.GetByID(ctx, id); err == nil && flow.Extension != "" {
		_ = s.cache.Del(ctx, cache.IvrKey(flow.Extension))
	}
	return s.repo.Delete(ctx, id)
}
