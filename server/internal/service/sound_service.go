package service

import (
	"context"
	"encoding/json"
	"errors"
	"os"

	"github.com/enjoys-in/enjoys-voice/api/internal/cache"
	"github.com/enjoys-in/enjoys-voice/api/internal/models"
	"github.com/enjoys-in/enjoys-voice/api/internal/repository"
)

var errSoundNotFound = errors.New("sound not found")

type soundService struct {
	soundRepo repository.SoundRepository
	userRepo  repository.UserRepository
	cache     cache.Cache
}

func NewSoundService(sr repository.SoundRepository, ur repository.UserRepository, c cache.Cache) SoundService {
	return &soundService{soundRepo: sr, userRepo: ur, cache: c}
}

func (s *soundService) Upload(ctx context.Context, ext string, soundType string, filename string, originalName string, path string) (*models.Sound, error) {
	user, err := s.userRepo.GetByExtension(ctx, ext)
	if err != nil {
		return nil, err
	}

	sound := &models.Sound{
		UserID:    user.ID,
		Extension: ext,
		Type:      soundType,
		Filename:  filename,
		Original:  originalName,
		Path:      path,
	}

	if err := s.soundRepo.Create(ctx, sound); err != nil {
		return nil, err
	}

	// Invalidate sounds cache
	_ = s.cache.Del(ctx, cache.SoundsKey(ext))
	return sound, nil
}

func (s *soundService) GetByExtension(ctx context.Context, ext string) ([]models.Sound, error) {
	// Try cache
	cached, err := s.cache.Get(ctx, cache.SoundsKey(ext))
	if err == nil && cached != "" {
		var sounds []models.Sound
		if json.Unmarshal([]byte(cached), &sounds) == nil {
			return sounds, nil
		}
	}

	sounds, err := s.soundRepo.GetByExtension(ctx, ext)
	if err != nil {
		return nil, err
	}

	data, _ := json.Marshal(sounds)
	_ = s.cache.Set(ctx, cache.SoundsKey(ext), string(data), cache.DefaultTTL)

	return sounds, nil
}

// Delete removes a sound owned by ext. It verifies ownership (IDOR guard),
// best-effort removes the file from disk, deletes the row, and invalidates the
// per-extension sounds cache. A sound that is missing or owned by another
// extension is reported as not found so callers cannot probe for foreign ids.
func (s *soundService) Delete(ctx context.Context, id uint, ext string) error {
	sound, err := s.soundRepo.GetByID(ctx, id)
	if err != nil || sound.Extension != ext {
		return errSoundNotFound
	}
	// Best-effort file cleanup; a missing file must not block the row delete.
	if sound.Path != "" {
		_ = os.Remove(sound.Path)
	}
	if err := s.soundRepo.Delete(ctx, id); err != nil {
		return err
	}
	_ = s.cache.Del(ctx, cache.SoundsKey(ext))
	return nil
}
