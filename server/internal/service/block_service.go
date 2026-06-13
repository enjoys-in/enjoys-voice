package service

import (
	"context"
	"encoding/json"

	"github.com/enjoys-in/enjoys-voice/api/internal/cache"
	"github.com/enjoys-in/enjoys-voice/api/internal/models"
	"github.com/enjoys-in/enjoys-voice/api/internal/repository"
)

type blockService struct {
	blockRepo repository.BlockRepository
	userRepo  repository.UserRepository
	cache     cache.Cache
}

func NewBlockService(br repository.BlockRepository, ur repository.UserRepository, c cache.Cache) BlockService {
	return &blockService{blockRepo: br, userRepo: ur, cache: c}
}

func (s *blockService) GetByExtension(ctx context.Context, ext string) ([]string, error) {
	// Try cache
	cached, err := s.cache.Get(ctx, cache.BlockedKey(ext))
	if err == nil && cached != "" {
		var numbers []string
		if json.Unmarshal([]byte(cached), &numbers) == nil {
			return numbers, nil
		}
	}

	numbers, err := s.blockRepo.GetByExtension(ctx, ext)
	if err != nil {
		return nil, err
	}

	// Cache it
	data, _ := json.Marshal(numbers)
	_ = s.cache.Set(ctx, cache.BlockedKey(ext), string(data), cache.DefaultTTL)

	return numbers, nil
}

func (s *blockService) Add(ctx context.Context, ext string, number string) error {
	user, err := s.userRepo.GetByExtension(ctx, ext)
	if err != nil {
		return err
	}

	block := &models.BlockedNumber{
		UserID:    user.ID,
		Extension: ext,
		Number:    number,
	}

	if err := s.blockRepo.Add(ctx, block); err != nil {
		return err
	}

	// Invalidate cache
	_ = s.cache.Del(ctx, cache.BlockedKey(ext))
	return nil
}

func (s *blockService) Remove(ctx context.Context, ext string, number string) error {
	if err := s.blockRepo.Remove(ctx, ext, number); err != nil {
		return err
	}
	_ = s.cache.Del(ctx, cache.BlockedKey(ext))
	return nil
}
