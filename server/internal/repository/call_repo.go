package repository

import (
	"context"
	"time"

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

// Stats aggregates the call_records table over the last `days` days for the
// admin dashboard. It runs three set-based queries (status breakdown, direction
// split, and a per-day series) instead of loading rows into memory.
func (r *callRepo) Stats(ctx context.Context, days int) (*models.CallStats, error) {
	if days <= 0 {
		days = 7
	}
	if days > 365 {
		days = 365
	}
	since := time.Now().AddDate(0, 0, -days)
	db := r.db.WithContext(ctx).Model(&models.CallRecord{})

	stats := &models.CallStats{RangeDays: days}

	// 1) Status breakdown + duration totals.
	type statusRow struct {
		Status string
		Cnt    int64
		DurSum int64
	}
	var statusRows []statusRow
	if err := db.
		Select("status, COUNT(*) AS cnt, COALESCE(SUM(duration),0) AS dur_sum").
		Where("started_at >= ?", since).
		Group("status").
		Scan(&statusRows).Error; err != nil {
		return nil, err
	}
	stats.StatusBreakdown = make([]models.StatusCount, 0, len(statusRows))
	for _, row := range statusRows {
		stats.TotalCalls += row.Cnt
		stats.TotalDuration += row.DurSum
		stats.StatusBreakdown = append(stats.StatusBreakdown, models.StatusCount{Status: row.Status, Count: row.Cnt})
		switch row.Status {
		case "answered", "ended":
			stats.Answered += row.Cnt
		case "missed":
			stats.Missed += row.Cnt
		case "failed":
			stats.Failed += row.Cnt
		case "voicemail":
			stats.Voicemail += row.Cnt
		case "unreachable":
			stats.Unreachable += row.Cnt
		}
	}

	// 2) Direction split.
	type dirRow struct {
		Direction string
		Cnt       int64
	}
	var dirRows []dirRow
	if err := db.
		Select("direction, COUNT(*) AS cnt").
		Where("started_at >= ?", since).
		Group("direction").
		Scan(&dirRows).Error; err != nil {
		return nil, err
	}
	for _, row := range dirRows {
		switch row.Direction {
		case "inbound":
			stats.Inbound += row.Cnt
		case "outbound":
			stats.Outbound += row.Cnt
		}
	}

	// Derived rates (guard divide-by-zero).
	if stats.TotalCalls > 0 {
		stats.ConnectionRate = float64(stats.Answered) / float64(stats.TotalCalls)
		stats.AbandonedRate = float64(stats.Missed+stats.Unreachable+stats.Failed) / float64(stats.TotalCalls)
	}
	if stats.Answered > 0 {
		stats.AvgDuration = stats.TotalDuration / stats.Answered
	}

	// 3) Per-day series (Postgres FILTER aggregates, oldest → newest).
	var buckets []models.CallStatsBucket
	if err := db.
		Select(`to_char(started_at::date, 'YYYY-MM-DD') AS date,
			COUNT(*) AS total,
			COUNT(*) FILTER (WHERE direction = 'inbound') AS inbound,
			COUNT(*) FILTER (WHERE direction = 'outbound') AS outbound,
			COUNT(*) FILTER (WHERE status IN ('answered','ended')) AS answered`).
		Where("started_at >= ?", since).
		Group("started_at::date").
		Order("started_at::date ASC").
		Scan(&buckets).Error; err != nil {
		return nil, err
	}
	stats.Series = buckets

	return stats, nil
}
