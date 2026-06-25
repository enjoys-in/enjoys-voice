package repository

import (
	"context"

	"github.com/enjoys-in/enjoys-voice/api/internal/models"
	"gorm.io/gorm"
)

// ContactRepository persists users' personal address-book entries. Every query
// is scoped by owner — a user only ever sees the contacts they created.
type ContactRepository interface {
	ListByOwner(ctx context.Context, owner string) ([]models.Contact, error)
	Get(ctx context.Context, id uint) (*models.Contact, error)
	Create(ctx context.Context, contact *models.Contact) error
	Update(ctx context.Context, contact *models.Contact) error
	Delete(ctx context.Context, id uint) error
}

type contactRepo struct {
	db *gorm.DB
}

func NewContactRepository(db *gorm.DB) ContactRepository {
	return &contactRepo{db: db}
}

func (r *contactRepo) ListByOwner(ctx context.Context, owner string) ([]models.Contact, error) {
	var contacts []models.Contact
	err := r.db.WithContext(ctx).Where("owner_extension = ?", owner).Order("name asc").Find(&contacts).Error
	return contacts, err
}

func (r *contactRepo) Get(ctx context.Context, id uint) (*models.Contact, error) {
	var contact models.Contact
	if err := r.db.WithContext(ctx).First(&contact, id).Error; err != nil {
		return nil, err
	}
	return &contact, nil
}

func (r *contactRepo) Create(ctx context.Context, contact *models.Contact) error {
	return r.db.WithContext(ctx).Create(contact).Error
}

func (r *contactRepo) Update(ctx context.Context, contact *models.Contact) error {
	return r.db.WithContext(ctx).Save(contact).Error
}

func (r *contactRepo) Delete(ctx context.Context, id uint) error {
	return r.db.WithContext(ctx).Delete(&models.Contact{}, id).Error
}
