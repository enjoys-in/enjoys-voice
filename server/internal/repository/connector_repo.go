package repository

import (
	"context"

	"github.com/enjoys-in/enjoys-voice/api/internal/models"
	"gorm.io/gorm"
)

// ConnectorRepository persists outbound integration connectors (email / webhook)
// used by the IVR flow builder.
type ConnectorRepository interface {
	List(ctx context.Context) ([]models.Connector, error)
	ListByOwner(ctx context.Context, owner string) ([]models.Connector, error)
	Get(ctx context.Context, id uint) (*models.Connector, error)
	Create(ctx context.Context, conn *models.Connector) error
	Update(ctx context.Context, conn *models.Connector) error
	Delete(ctx context.Context, id uint) error
}

type connectorRepo struct {
	db *gorm.DB
}

func NewConnectorRepository(db *gorm.DB) ConnectorRepository {
	return &connectorRepo{db: db}
}

func (r *connectorRepo) List(ctx context.Context) ([]models.Connector, error) {
	var conns []models.Connector
	err := r.db.WithContext(ctx).Order("id asc").Find(&conns).Error
	return conns, err
}

func (r *connectorRepo) ListByOwner(ctx context.Context, owner string) ([]models.Connector, error) {
	var conns []models.Connector
	err := r.db.WithContext(ctx).Where("owner_extension = ?", owner).Order("id asc").Find(&conns).Error
	return conns, err
}

func (r *connectorRepo) Get(ctx context.Context, id uint) (*models.Connector, error) {
	var conn models.Connector
	if err := r.db.WithContext(ctx).First(&conn, id).Error; err != nil {
		return nil, err
	}
	return &conn, nil
}

func (r *connectorRepo) Create(ctx context.Context, conn *models.Connector) error {
	return r.db.WithContext(ctx).Create(conn).Error
}

func (r *connectorRepo) Update(ctx context.Context, conn *models.Connector) error {
	return r.db.WithContext(ctx).Save(conn).Error
}

func (r *connectorRepo) Delete(ctx context.Context, id uint) error {
	return r.db.WithContext(ctx).Delete(&models.Connector{}, id).Error
}
