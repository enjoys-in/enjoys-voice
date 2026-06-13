package repository

import (
	"context"

	"github.com/enjoys-in/enjoys-voice/api/internal/models"
	"gorm.io/gorm"
)

type callRepo struct {
	db *gorm.DB
}

func NewCallRepository(db *gorm.DB) CallRepository {
	return &callRepo{db: db}
}

func (r *callRepo) Create(ctx context.Context, call *models.CallRecord) error {
	return r.db.WithContext(ctx).Create(call).Error
}

func (r *callRepo) GetAll(ctx context.Context) ([]models.CallRecord, error) {
	var calls []models.CallRecord
	err := r.db.WithContext(ctx).Order("started_at DESC").Limit(200).Find(&calls).Error
	return calls, err
}

func (r *callRepo) GetByExtension(ctx context.Context, ext string) ([]models.CallRecord, error) {
	var calls []models.CallRecord
	// Match the resolved owner extensions first (covers PSTN legs, where from/to
	// hold an external number), falling back to the raw leg strings for any row
	// written without a resolved owner.
	err := r.db.WithContext(ctx).
		Where(`from_ext = ? OR to_ext = ? OR "from" = ? OR "to" = ?`, ext, ext, ext, ext).
		Order("started_at DESC").
		Limit(100).
		Find(&calls).Error
	return calls, err
}

// DeleteByExtension removes every call-history row owned by ext (both resolved
// owner columns and the raw leg strings, mirroring GetByExtension), so the
// user's "clear recents" action actually purges the shared table. Returns the
// number of rows deleted.
func (r *callRepo) DeleteByExtension(ctx context.Context, ext string) (int64, error) {
	res := r.db.WithContext(ctx).
		Where(`from_ext = ? OR to_ext = ? OR "from" = ? OR "to" = ?`, ext, ext, ext, ext).
		Delete(&models.CallRecord{})
	return res.RowsAffected, res.Error
}
