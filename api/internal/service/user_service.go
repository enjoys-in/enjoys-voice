package service

import (
	"context"

	"github.com/enjoys-in/enjoys-voice/api/internal/cache"
	"github.com/enjoys-in/enjoys-voice/api/internal/models"
	"github.com/enjoys-in/enjoys-voice/api/internal/repository"
)

type userService struct {
	userRepo     repository.UserRepository
	settingsRepo repository.SettingsRepository
	blockRepo    repository.BlockRepository
	fwdRepo      repository.ForwardingRepository
	soundRepo    repository.SoundRepository
	cache        cache.Cache
}

func NewUserService(
	ur repository.UserRepository,
	sr repository.SettingsRepository,
	br repository.BlockRepository,
	fr repository.ForwardingRepository,
	snr repository.SoundRepository,
	c cache.Cache,
) UserService {
	return &userService{
		userRepo: ur, settingsRepo: sr, blockRepo: br,
		fwdRepo: fr, soundRepo: snr, cache: c,
	}
}

func (s *userService) GetAll(ctx context.Context) ([]models.User, error) {
	return s.userRepo.GetAll(ctx)
}

func (s *userService) GetByExtension(ctx context.Context, ext string) (*models.User, error) {
	return s.userRepo.GetByExtension(ctx, ext)
}

func (s *userService) Delete(ctx context.Context, ext string) error {
	// Delete user (CASCADE handles related records)
	if err := s.userRepo.Delete(ctx, ext); err != nil {
		return err
	}

	// Invalidate all cache keys
	_ = s.cache.Del(ctx,
		cache.UserKey(ext),
		cache.SettingsKey(ext),
		cache.BlockedKey(ext),
		cache.ForwardingKey(ext),
		cache.SoundsKey(ext),
	)

	return nil
}
