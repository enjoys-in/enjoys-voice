package repository

import (
	"context"

	"github.com/enjoys-in/enjoys-voice/api/internal/models"
)

// Additional voicemail queries. The voicemailRepo type, its constructor, and
// the Create/GetByExtension/MarkRead methods live in sound_repo.go.

func (r *voicemailRepo) GetByID(ctx context.Context, id uint) (*models.Voicemail, error) {
	var vm models.Voicemail
	if err := r.db.WithContext(ctx).Where("id = ?", id).First(&vm).Error; err != nil {
		return nil, err
	}
	return &vm, nil
}

func (r *voicemailRepo) Delete(ctx context.Context, id uint) error {
	return r.db.WithContext(ctx).Where("id = ?", id).Delete(&models.Voicemail{}).Error
}

func (r *voicemailRepo) UnreadCount(ctx context.Context, ext string) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&models.Voicemail{}).
		Where("extension = ? AND read = ?", ext, false).
		Count(&count).Error
	return count, err
}
