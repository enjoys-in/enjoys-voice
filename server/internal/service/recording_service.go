package service

import (
	"context"
	"errors"
	"time"

	"github.com/enjoys-in/enjoys-voice/api/internal/models"
	"github.com/enjoys-in/enjoys-voice/api/internal/repository"
	"gorm.io/gorm"
)

// ErrRecordingNotFound is returned when a recording id doesn't exist (404).
var ErrRecordingNotFound = errors.New("recording not found")

// RecordingView is the API view of a call recording (no filesystem paths).
type RecordingView struct {
	ID        uint      `json:"id"`
	Extension string    `json:"extension"`
	CallID    string    `json:"call_id"`
	Filename  string    `json:"filename"`
	Duration  int       `json:"duration"`
	CreatedAt time.Time `json:"created_at"`
}

// RecordingService owns read/delete over call recordings. Recordings are written
// by the call engine (which media-anchors a call through FreeSWITCH when the
// party has recording enabled) and are owner-scoped for playback: a user only
// ever lists/streams/deletes recordings of calls they were a party to.
type RecordingService interface {
	ListByOwner(ctx context.Context, owner string) ([]RecordingView, error)
	// Get returns the raw model (incl. path) for ownership checks + streaming.
	Get(ctx context.Context, id uint) (*models.Recording, error)
	Delete(ctx context.Context, id uint) error
}

type recordingService struct {
	repo repository.RecordingRepository
}

func NewRecordingService(repo repository.RecordingRepository) RecordingService {
	return &recordingService{repo: repo}
}

func (s *recordingService) ListByOwner(ctx context.Context, owner string) ([]RecordingView, error) {
	recs, err := s.repo.GetByExtension(ctx, owner)
	if err != nil {
		return nil, err
	}
	out := make([]RecordingView, 0, len(recs))
	for i := range recs {
		out = append(out, toRecordingView(&recs[i]))
	}
	return out, nil
}

func (s *recordingService) Get(ctx context.Context, id uint) (*models.Recording, error) {
	rec, err := s.repo.Get(ctx, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrRecordingNotFound
		}
		return nil, err
	}
	return rec, nil
}

func (s *recordingService) Delete(ctx context.Context, id uint) error {
	if _, err := s.repo.Get(ctx, id); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrRecordingNotFound
		}
		return err
	}
	return s.repo.Delete(ctx, id)
}

func toRecordingView(r *models.Recording) RecordingView {
	return RecordingView{
		ID:        r.ID,
		Extension: r.Extension,
		CallID:    r.CallID,
		Filename:  r.Filename,
		Duration:  r.Duration,
		CreatedAt: r.CreatedAt,
	}
}
