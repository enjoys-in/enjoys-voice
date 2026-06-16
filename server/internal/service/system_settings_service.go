package service

import (
	"context"

	"github.com/enjoys-in/enjoys-voice/api/internal/models"
	"github.com/enjoys-in/enjoys-voice/api/internal/repository"
)

type systemSettingsService struct {
	repo repository.SystemSettingsRepository
}

func NewSystemSettingsService(repo repository.SystemSettingsRepository) SystemSettingsService {
	return &systemSettingsService{repo: repo}
}

func (s *systemSettingsService) Get(ctx context.Context) (*models.SystemSettingsResponse, error) {
	settings, err := s.repo.Get(ctx)
	if err != nil {
		return nil, err
	}
	resp := settings.ToResponse()
	return &resp, nil
}

func (s *systemSettingsService) Update(ctx context.Context, input *SystemSettingsInput) (*models.SystemSettingsResponse, error) {
	settings, err := s.repo.Get(ctx)
	if err != nil {
		return nil, err
	}

	// Apply partial updates — only the provided fields change.
	if input.BrandName != nil {
		settings.BrandName = *input.BrandName
	}
	if input.BrandTagline != nil {
		settings.BrandTagline = *input.BrandTagline
	}
	if input.AccentColor != nil {
		settings.AccentColor = *input.AccentColor
	}
	if input.LogoURL != nil {
		settings.LogoURL = *input.LogoURL
	}
	if input.SupportEmail != nil {
		settings.SupportEmail = *input.SupportEmail
	}
	if input.DefaultRecording != nil {
		settings.DefaultRecording = *input.DefaultRecording
	}
	if input.DefaultVoicemail != nil {
		settings.DefaultVoicemail = *input.DefaultVoicemail
	}
	if input.AllowUserDND != nil {
		settings.AllowUserDND = *input.AllowUserDND
	}
	if input.RecordingRetentionDays != nil {
		settings.RecordingRetentionDays = *input.RecordingRetentionDays
	}
	if input.MaxConcurrentCalls != nil {
		settings.MaxConcurrentCalls = *input.MaxConcurrentCalls
	}

	if err := s.repo.Save(ctx, settings); err != nil {
		return nil, err
	}

	resp := settings.ToResponse()
	return &resp, nil
}
