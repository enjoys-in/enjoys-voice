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
	return r.statsFiltered(ctx, days, "")
}

// StatsByExtension is the owner-scoped variant of Stats: it computes the same
// aggregates but only over the rows owned by ext (mirroring GetByExtension's
// from_ext/to_ext/"from"/"to" match), so a non-admin user sees stats for their
// own call history rather than the global firehose.
func (r *callRepo) StatsByExtension(ctx context.Context, ext string, days int) (*models.CallStats, error) {
	return r.statsFiltered(ctx, days, ext)
}

// statsFiltered backs both Stats (ext == "") and StatsByExtension (ext != "").
// When ext is non-empty every aggregate query is additionally constrained to
// the caller's own legs.
func (r *callRepo) statsFiltered(ctx context.Context, days int, ext string) (*models.CallStats, error) {
	if days <= 0 {
		days = 7
	}
	if days > 365 {
		days = 365
	}
	since := time.Now().AddDate(0, 0, -days)

	// scope returns a fresh query carrying the time-window (and, for the
	// owner-scoped variant, the ext ownership filter) shared by every aggregate
	// query below.
	scope := func() *gorm.DB {
		q := r.db.WithContext(ctx).Model(&models.CallRecord{}).Where("started_at >= ?", since)
		if ext != "" {
			q = q.Where(`from_ext = ? OR to_ext = ? OR "from" = ? OR "to" = ?`, ext, ext, ext, ext)
		}
		return q
	}

	stats := &models.CallStats{RangeDays: days}

	// 1) Status breakdown + duration totals.
	type statusRow struct {
		Status  string
		Cnt     int64
		DurSum  int64
		CostSum float64
	}
	var statusRows []statusRow
	if err := scope().
		Select("status, COUNT(*) AS cnt, COALESCE(SUM(duration),0) AS dur_sum, COALESCE(SUM(cost),0) AS cost_sum").
		Group("status").
		Scan(&statusRows).Error; err != nil {
		return nil, err
	}
	stats.StatusBreakdown = make([]models.StatusCount, 0, len(statusRows))
	for _, row := range statusRows {
		stats.TotalCalls += row.Cnt
		stats.TotalDuration += row.DurSum
		stats.TotalCost += row.CostSum
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
	if err := scope().
		Select("direction, COUNT(*) AS cnt").
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

	// Dominant currency among rated rows (the currency the cost totals are in).
	// With a single rate plan this is simply that plan's currency.
	if stats.TotalCost > 0 {
		var currency string
		if err := scope().
			Select("currency").
			Where("currency <> '' AND cost > 0").
			Group("currency").
			Order("SUM(cost) DESC").
			Limit(1).
			Scan(&currency).Error; err == nil {
			stats.Currency = currency
		}
	}

	// 3) Per-day series (Postgres FILTER aggregates, oldest → newest).
	var buckets []models.CallStatsBucket
	if err := scope().
		Select(`to_char(started_at::date, 'YYYY-MM-DD') AS date,
			COUNT(*) AS total,
			COUNT(*) FILTER (WHERE direction = 'inbound') AS inbound,
			COUNT(*) FILTER (WHERE direction = 'outbound') AS outbound,
			COUNT(*) FILTER (WHERE status IN ('answered','ended')) AS answered,
			COALESCE(SUM(cost),0) AS cost`).
		Group("started_at::date").
		Order("started_at::date ASC").
		Scan(&buckets).Error; err != nil {
		return nil, err
	}
	stats.Series = buckets

	return stats, nil
}
