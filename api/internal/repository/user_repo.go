package repository

import (
	"context"

	"github.com/enjoys-in/enjoys-voice/api/internal/models"
	"gorm.io/gorm"
)

type userRepo struct {
	db *gorm.DB
}

func NewUserRepository(db *gorm.DB) UserRepository {
	return &userRepo{db: db}
}

func (r *userRepo) Create(ctx context.Context, user *models.User) error {
	return r.db.WithContext(ctx).Create(user).Error
}

func (r *userRepo) GetByExtension(ctx context.Context, ext string) (*models.User, error) {
	var user models.User
	err := r.db.WithContext(ctx).Where("extension = ?", ext).First(&user).Error
	if err != nil {
		return nil, err
	}
	return &user, nil
}

func (r *userRepo) GetByMobile(ctx context.Context, mobile string) (*models.User, error) {
	var user models.User
	err := r.db.WithContext(ctx).Where("mobile = ?", mobile).First(&user).Error
	if err != nil {
		return nil, err
	}
	return &user, nil
}

func (r *userRepo) GetByUsername(ctx context.Context, username string) (*models.User, error) {
	var user models.User
	err := r.db.WithContext(ctx).Where("username = ?", username).First(&user).Error
	if err != nil {
		return nil, err
	}
	return &user, nil
}

func (r *userRepo) GetAll(ctx context.Context) ([]models.User, error) {
	var users []models.User
	err := r.db.WithContext(ctx).Order("created_at DESC").Find(&users).Error
	return users, err
}

func (r *userRepo) UpdateName(ctx context.Context, ext, name string) error {
	return r.db.WithContext(ctx).
		Model(&models.User{}).
		Where("extension = ?", ext).
		Update("name", name).Error
}

func (r *userRepo) Delete(ctx context.Context, ext string) error {
	return r.db.WithContext(ctx).Where("extension = ?", ext).Delete(&models.User{}).Error
}
