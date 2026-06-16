package repository

import (
	"context"

	"github.com/enjoys-in/enjoys-voice/api/internal/models"
	"gorm.io/gorm"
)

type soundRepo struct {
	db *gorm.DB
}

func NewSoundRepository(db *gorm.DB) SoundRepository {
	return &soundRepo{db: db}
}

func (r *soundRepo) Create(ctx context.Context, sound *models.Sound) error {
	return r.db.WithContext(ctx).Create(sound).Error
}

func (r *soundRepo) GetByExtension(ctx context.Context, ext string) ([]models.Sound, error) {
	var sounds []models.Sound
	err := r.db.WithContext(ctx).Where("extension = ?", ext).Order("created_at DESC").Find(&sounds).Error
	return sounds, err
}

func (r *soundRepo) GetByID(ctx context.Context, id uint) (*models.Sound, error) {
	var sound models.Sound
	if err := r.db.WithContext(ctx).First(&sound, id).Error; err != nil {
		return nil, err
	}
	return &sound, nil
}

func (r *soundRepo) Delete(ctx context.Context, id uint) error {
	return r.db.WithContext(ctx).Delete(&models.Sound{}, id).Error
}

func (r *soundRepo) DeleteAll(ctx context.Context, ext string) error {
	return r.db.WithContext(ctx).Where("extension = ?", ext).Delete(&models.Sound{}).Error
}

// Recording repo

type recordingRepo struct {
	db *gorm.DB
}

func NewRecordingRepository(db *gorm.DB) RecordingRepository {
	return &recordingRepo{db: db}
}

func (r *recordingRepo) Create(ctx context.Context, rec *models.Recording) error {
	return r.db.WithContext(ctx).Create(rec).Error
}

func (r *recordingRepo) GetByExtension(ctx context.Context, ext string) ([]models.Recording, error) {
	var recs []models.Recording
	err := r.db.WithContext(ctx).Where("extension = ?", ext).Order("created_at DESC").Find(&recs).Error
	return recs, err
}

// Voicemail repo

type voicemailRepo struct {
	db *gorm.DB
}

func NewVoicemailRepository(db *gorm.DB) VoicemailRepository {
	return &voicemailRepo{db: db}
}

func (r *voicemailRepo) Create(ctx context.Context, vm *models.Voicemail) error {
	return r.db.WithContext(ctx).Create(vm).Error
}

func (r *voicemailRepo) GetByExtension(ctx context.Context, ext string) ([]models.Voicemail, error) {
	var vms []models.Voicemail
	err := r.db.WithContext(ctx).Where("extension = ?", ext).Order("created_at DESC").Find(&vms).Error
	return vms, err
}

func (r *voicemailRepo) MarkRead(ctx context.Context, id uint) error {
	return r.db.WithContext(ctx).Model(&models.Voicemail{}).Where("id = ?", id).Update("read", true).Error
}
