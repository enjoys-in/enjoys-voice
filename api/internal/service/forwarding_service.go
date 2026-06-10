package service

import (
	"context"
	"encoding/json"

	"github.com/enjoys-in/enjoys-voice/api/internal/cache"
	"github.com/enjoys-in/enjoys-voice/api/internal/models"
	"github.com/enjoys-in/enjoys-voice/api/internal/repository"
)

type forwardingService struct {
	fwdRepo  repository.ForwardingRepository
	userRepo repository.UserRepository
	cache    cache.Cache
}

func NewForwardingService(fr repository.ForwardingRepository, ur repository.UserRepository, c cache.Cache) ForwardingService {
	return &forwardingService{fwdRepo: fr, userRepo: ur, cache: c}
}

func (s *forwardingService) Get(ctx context.Context, ext string) (*models.ForwardingResponse, error) {
	// Try cache
	cached, err := s.cache.Get(ctx, cache.ForwardingKey(ext))
	if err == nil && cached != "" {
		var resp models.ForwardingResponse
		if json.Unmarshal([]byte(cached), &resp) == nil {
			return &resp, nil
		}
	}

	resp, err := s.fwdRepo.Get(ctx, ext)
	if err != nil {
		return nil, err
	}

	// Cache
	data, _ := json.Marshal(resp)
	_ = s.cache.Set(ctx, cache.ForwardingKey(ext), string(data), cache.DefaultTTL)

	return resp, nil
}

func (s *forwardingService) Set(ctx context.Context, ext string, fwdType string, target string) error {
	user, err := s.userRepo.GetByExtension(ctx, ext)
	if err != nil {
		return err
	}

	rule := &models.ForwardingRule{
		UserID:    user.ID,
		Extension: ext,
		Type:      fwdType,
		Target:    target,
	}

	if err := s.fwdRepo.Set(ctx, rule); err != nil {
		return err
	}

	// Invalidate cache
	_ = s.cache.Del(ctx, cache.ForwardingKey(ext))
	return nil
}
