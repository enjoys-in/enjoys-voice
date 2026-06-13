package service

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/enjoys-in/enjoys-voice/api/internal/cache"
	"github.com/enjoys-in/enjoys-voice/api/internal/models"
	"github.com/enjoys-in/enjoys-voice/api/internal/repository"
)

type settingsService struct {
	settingsRepo repository.SettingsRepository
	userRepo     repository.UserRepository
	cache        cache.Cache
}

func NewSettingsService(sr repository.SettingsRepository, ur repository.UserRepository, c cache.Cache) SettingsService {
	return &settingsService{settingsRepo: sr, userRepo: ur, cache: c}
}

func (s *settingsService) Get(ctx context.Context, ext string) (*models.SettingsResponse, error) {
	// Try cache first
	cached, err := s.cache.Get(ctx, cache.SettingsKey(ext))
	if err == nil && cached != "" {
		var resp models.SettingsResponse
		if json.Unmarshal([]byte(cached), &resp) == nil {
			return &resp, nil
		}
	}

	// Fallback to DB
	settings, err := s.settingsRepo.Get(ctx, ext)
	if err != nil {
		return nil, errors.New("settings not found")
	}

	resp := settings.ToResponse()

	// Store in cache
	data, _ := json.Marshal(resp)
	_ = s.cache.Set(ctx, cache.SettingsKey(ext), string(data), cache.DefaultTTL)

	return &resp, nil
}

func (s *settingsService) Update(ctx context.Context, ext string, input *SettingsInput) (*models.SettingsResponse, error) {
	settings, err := s.settingsRepo.Get(ctx, ext)
	if err != nil {
		// Create if not exists
		user, userErr := s.userRepo.GetByExtension(ctx, ext)
		if userErr != nil {
			return nil, errors.New("user not found")
		}
		settings = &models.UserSettings{
			UserID:    user.ID,
			Extension: ext,
		}
	}

	// Apply partial updates
	if input.SoundsEnabled != nil {
		settings.SoundsEnabled = *input.SoundsEnabled
	}
	if input.DtmfEnabled != nil {
		settings.DtmfEnabled = *input.DtmfEnabled
	}
	if input.CallerTune != nil {
		settings.CallerTune = *input.CallerTune
	}
	if input.Ringtone != nil {
		settings.Ringtone = *input.Ringtone
	}
	if input.PstnEnabled != nil {
		settings.PstnEnabled = *input.PstnEnabled
	}
	if input.PstnMobile != nil {
		settings.PstnMobile = *input.PstnMobile
	}
	if input.PstnCountryCode != nil {
		settings.PstnCountryCode = *input.PstnCountryCode
	}
	if input.RecordingEnabled != nil {
		settings.RecordingEnabled = *input.RecordingEnabled
	}
	if input.VoicemailEnabled != nil {
		settings.VoicemailEnabled = *input.VoicemailEnabled
	}

	if err := s.settingsRepo.Upsert(ctx, settings); err != nil {
		return nil, err
	}

	resp := settings.ToResponse()

	// Invalidate + refresh cache
	data, _ := json.Marshal(resp)
	_ = s.cache.Set(ctx, cache.SettingsKey(ext), string(data), cache.DefaultTTL)

	return &resp, nil
}

func (s *settingsService) WarmCache(ctx context.Context, ext string) error {
	settings, err := s.settingsRepo.Get(ctx, ext)
	if err != nil {
		return err
	}
	resp := settings.ToResponse()
	data, _ := json.Marshal(resp)
	return s.cache.Set(ctx, cache.SettingsKey(ext), string(data), cache.DefaultTTL)
}

// GetPstnForward returns the PSTN forwarding view derived from UserSettings.
func (s *settingsService) GetPstnForward(ctx context.Context, ext string) (*PstnForward, error) {
	settings, err := s.settingsRepo.Get(ctx, ext)
	if err != nil {
		return &PstnForward{Enabled: false, Target: ""}, nil
	}
	return &PstnForward{Enabled: settings.PstnEnabled, Target: settings.PstnMobile}, nil
}

// SetPstnForward updates the PSTN forwarding fields on UserSettings, creating
// the settings row if it does not exist yet.
func (s *settingsService) SetPstnForward(ctx context.Context, ext string, enabled bool, target string) (*PstnForward, error) {
	settings, err := s.settingsRepo.Get(ctx, ext)
	if err != nil {
		user, userErr := s.userRepo.GetByExtension(ctx, ext)
		if userErr != nil {
			return nil, errors.New("user not found")
		}
		settings = &models.UserSettings{UserID: user.ID, Extension: ext}
	}

	settings.PstnEnabled = enabled
	settings.PstnMobile = target

	if err := s.settingsRepo.Upsert(ctx, settings); err != nil {
		return nil, err
	}

	// Refresh the settings cache so the SIP layer sees the change.
	resp := settings.ToResponse()
	data, _ := json.Marshal(resp)
	_ = s.cache.Set(ctx, cache.SettingsKey(ext), string(data), cache.DefaultTTL)

	return &PstnForward{Enabled: settings.PstnEnabled, Target: settings.PstnMobile}, nil
}
