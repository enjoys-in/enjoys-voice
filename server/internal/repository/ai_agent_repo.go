package repository

import (
	"context"

	"github.com/enjoys-in/enjoys-voice/api/internal/models"
	"gorm.io/gorm"
)

// AiAgentRepository persists users' per-user AI voice agents. Every query is
// scoped by owner — a user only ever sees the agents they created.
type AiAgentRepository interface {
	ListByOwner(ctx context.Context, owner string) ([]models.AiAgent, error)
	Get(ctx context.Context, id uint) (*models.AiAgent, error)
	Create(ctx context.Context, agent *models.AiAgent) error
	Update(ctx context.Context, agent *models.AiAgent) error
	Delete(ctx context.Context, id uint) error
}

type aiAgentRepo struct {
	db *gorm.DB
}

func NewAiAgentRepository(db *gorm.DB) AiAgentRepository {
	return &aiAgentRepo{db: db}
}

func (r *aiAgentRepo) ListByOwner(ctx context.Context, owner string) ([]models.AiAgent, error) {
	var agents []models.AiAgent
	err := r.db.WithContext(ctx).Where("owner_extension = ?", owner).Order("created_at desc").Find(&agents).Error
	return agents, err
}

func (r *aiAgentRepo) Get(ctx context.Context, id uint) (*models.AiAgent, error) {
	var agent models.AiAgent
	if err := r.db.WithContext(ctx).First(&agent, id).Error; err != nil {
		return nil, err
	}
	return &agent, nil
}

func (r *aiAgentRepo) Create(ctx context.Context, agent *models.AiAgent) error {
	return r.db.WithContext(ctx).Create(agent).Error
}

func (r *aiAgentRepo) Update(ctx context.Context, agent *models.AiAgent) error {
	return r.db.WithContext(ctx).Save(agent).Error
}

func (r *aiAgentRepo) Delete(ctx context.Context, id uint) error {
	return r.db.WithContext(ctx).Delete(&models.AiAgent{}, id).Error
}
