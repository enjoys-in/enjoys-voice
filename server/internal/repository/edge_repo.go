package repository

import (
	"context"
	"time"

	"github.com/enjoys-in/enjoys-voice/api/internal/models"
	"gorm.io/gorm"
)

// EdgeRepository owns edge-appliance devices, their CDR ingest, and the user
// lookup the device sync needs (to attach display names to assigned extensions).
type EdgeRepository interface {
	ListDevices(ctx context.Context) ([]models.EdgeDevice, error)
	GetDevice(ctx context.Context, id uint) (*models.EdgeDevice, error)
	GetDeviceByDeviceID(ctx context.Context, deviceID string) (*models.EdgeDevice, error)
	CreateDevice(ctx context.Context, d *models.EdgeDevice) error
	UpdateDevice(ctx context.Context, d *models.EdgeDevice) error
	DeleteDevice(ctx context.Context, id uint) error
	TouchDevice(ctx context.Context, deviceID string, at time.Time) error
	InsertCDRs(ctx context.Context, rows []models.EdgeCDR) error
	UsersByExtensions(ctx context.Context, exts []string) ([]models.User, error)
}

type edgeRepo struct {
	db *gorm.DB
}

func NewEdgeRepository(db *gorm.DB) EdgeRepository {
	return &edgeRepo{db: db}
}

func (r *edgeRepo) ListDevices(ctx context.Context) ([]models.EdgeDevice, error) {
	var devices []models.EdgeDevice
	err := r.db.WithContext(ctx).Order("id asc").Find(&devices).Error
	return devices, err
}

func (r *edgeRepo) GetDevice(ctx context.Context, id uint) (*models.EdgeDevice, error) {
	var d models.EdgeDevice
	if err := r.db.WithContext(ctx).First(&d, id).Error; err != nil {
		return nil, err
	}
	return &d, nil
}

func (r *edgeRepo) GetDeviceByDeviceID(ctx context.Context, deviceID string) (*models.EdgeDevice, error) {
	var d models.EdgeDevice
	if err := r.db.WithContext(ctx).Where("device_id = ?", deviceID).First(&d).Error; err != nil {
		return nil, err
	}
	return &d, nil
}

func (r *edgeRepo) CreateDevice(ctx context.Context, d *models.EdgeDevice) error {
	return r.db.WithContext(ctx).Create(d).Error
}

func (r *edgeRepo) UpdateDevice(ctx context.Context, d *models.EdgeDevice) error {
	return r.db.WithContext(ctx).Save(d).Error
}

func (r *edgeRepo) DeleteDevice(ctx context.Context, id uint) error {
	return r.db.WithContext(ctx).Delete(&models.EdgeDevice{}, id).Error
}

func (r *edgeRepo) TouchDevice(ctx context.Context, deviceID string, at time.Time) error {
	return r.db.WithContext(ctx).Model(&models.EdgeDevice{}).
		Where("device_id = ?", deviceID).
		Update("last_seen_at", at).Error
}

func (r *edgeRepo) InsertCDRs(ctx context.Context, rows []models.EdgeCDR) error {
	if len(rows) == 0 {
		return nil
	}
	return r.db.WithContext(ctx).Create(&rows).Error
}

func (r *edgeRepo) UsersByExtensions(ctx context.Context, exts []string) ([]models.User, error) {
	if len(exts) == 0 {
		return nil, nil
	}
	var users []models.User
	err := r.db.WithContext(ctx).Where("extension IN ?", exts).Find(&users).Error
	return users, err
}
