package service

import (
	"context"
	"errors"

	"github.com/enjoys-in/enjoys-voice/api/internal/models"
	"github.com/enjoys-in/enjoys-voice/api/internal/repository"
)

var errVoicemailNotFound = errors.New("voicemail not found")

type voicemailService struct {
	repo repository.VoicemailRepository
}

func NewVoicemailService(r repository.VoicemailRepository) VoicemailService {
	return &voicemailService{repo: r}
}

func (s *voicemailService) List(ctx context.Context, ext string) ([]models.Voicemail, int64, error) {
	vms, err := s.repo.GetByExtension(ctx, ext)
	if err != nil {
		return nil, 0, err
	}
	unread, err := s.repo.UnreadCount(ctx, ext)
	if err != nil {
		return nil, 0, err
	}
	return vms, unread, nil
}

// Get returns a voicemail only if it belongs to the given extension.
func (s *voicemailService) Get(ctx context.Context, ext string, id uint) (*models.Voicemail, error) {
	vm, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return nil, errVoicemailNotFound
	}
	if vm.Extension != ext {
		return nil, errVoicemailNotFound
	}
	return vm, nil
}

func (s *voicemailService) MarkRead(ctx context.Context, ext string, id uint) (int64, error) {
	if _, err := s.Get(ctx, ext, id); err != nil {
		return 0, err
	}
	if err := s.repo.MarkRead(ctx, id); err != nil {
		return 0, err
	}
	return s.repo.UnreadCount(ctx, ext)
}

func (s *voicemailService) Delete(ctx context.Context, ext string, id uint) (int64, error) {
	if _, err := s.Get(ctx, ext, id); err != nil {
		return 0, err
	}
	if err := s.repo.Delete(ctx, id); err != nil {
		return 0, err
	}
	return s.repo.UnreadCount(ctx, ext)
}
