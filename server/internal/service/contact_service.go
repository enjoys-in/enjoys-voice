package service

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/enjoys-in/enjoys-voice/api/internal/models"
	"github.com/enjoys-in/enjoys-voice/api/internal/repository"
	"gorm.io/gorm"
)

// ErrContactNotFound is returned when a contact id doesn't exist (404).
var ErrContactNotFound = errors.New("contact not found")

// ErrContactInvalid is returned when required fields are missing (400).
var ErrContactInvalid = errors.New("name and extension are required")

// ContactInput is a partial create/update of a personal contact. Only non-nil
// fields are applied.
type ContactInput struct {
	Name      *string `json:"name"`
	Extension *string `json:"extension"`
	Username  *string `json:"username"`
}

// ContactView is the API view of a personal contact.
type ContactView struct {
	ID             uint      `json:"id"`
	OwnerExtension string    `json:"ownerExtension"`
	Name           string    `json:"name"`
	Extension      string    `json:"extension"`
	Username       string    `json:"username,omitempty"`
	CreatedAt      time.Time `json:"createdAt"`
	UpdatedAt      time.Time `json:"updatedAt"`
}

// ContactService owns CRUD over users' personal address-book entries.
type ContactService interface {
	ListByOwner(ctx context.Context, owner string) ([]ContactView, error)
	Get(ctx context.Context, id uint) (*ContactView, error)
	Create(ctx context.Context, owner string, input *ContactInput) (*ContactView, error)
	Update(ctx context.Context, id uint, input *ContactInput) (*ContactView, error)
	Delete(ctx context.Context, id uint) error
}

type contactService struct {
	repo repository.ContactRepository
}

func NewContactService(repo repository.ContactRepository) ContactService {
	return &contactService{repo: repo}
}

func (s *contactService) ListByOwner(ctx context.Context, owner string) ([]ContactView, error) {
	contacts, err := s.repo.ListByOwner(ctx, owner)
	if err != nil {
		return nil, err
	}
	out := make([]ContactView, 0, len(contacts))
	for i := range contacts {
		out = append(out, toContactView(&contacts[i]))
	}
	return out, nil
}

func (s *contactService) Get(ctx context.Context, id uint) (*ContactView, error) {
	contact, err := s.repo.Get(ctx, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrContactNotFound
		}
		return nil, err
	}
	v := toContactView(contact)
	return &v, nil
}

func (s *contactService) Create(ctx context.Context, owner string, input *ContactInput) (*ContactView, error) {
	contact := &models.Contact{OwnerExtension: owner}
	applyContactInput(contact, input)
	if contact.Name == "" || contact.Extension == "" {
		return nil, ErrContactInvalid
	}
	if contact.Username == "" {
		contact.Username = contact.Extension
	}
	if err := s.repo.Create(ctx, contact); err != nil {
		return nil, err
	}
	v := toContactView(contact)
	return &v, nil
}

func (s *contactService) Update(ctx context.Context, id uint, input *ContactInput) (*ContactView, error) {
	contact, err := s.repo.Get(ctx, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrContactNotFound
		}
		return nil, err
	}
	applyContactInput(contact, input)
	if contact.Name == "" || contact.Extension == "" {
		return nil, ErrContactInvalid
	}
	if contact.Username == "" {
		contact.Username = contact.Extension
	}
	if err := s.repo.Update(ctx, contact); err != nil {
		return nil, err
	}
	v := toContactView(contact)
	return &v, nil
}

func (s *contactService) Delete(ctx context.Context, id uint) error {
	if _, err := s.repo.Get(ctx, id); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrContactNotFound
		}
		return err
	}
	return s.repo.Delete(ctx, id)
}

// applyContactInput copies non-nil, trimmed input fields onto the contact.
func applyContactInput(c *models.Contact, input *ContactInput) {
	if input.Name != nil {
		c.Name = strings.TrimSpace(*input.Name)
	}
	if input.Extension != nil {
		c.Extension = strings.TrimSpace(*input.Extension)
	}
	if input.Username != nil {
		c.Username = strings.TrimSpace(*input.Username)
	}
}

func toContactView(c *models.Contact) ContactView {
	return ContactView{
		ID:             c.ID,
		OwnerExtension: c.OwnerExtension,
		Name:           c.Name,
		Extension:      c.Extension,
		Username:       c.Username,
		CreatedAt:      c.CreatedAt,
		UpdatedAt:      c.UpdatedAt,
	}
}
