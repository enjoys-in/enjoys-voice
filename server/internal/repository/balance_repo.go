package repository

import (
	"context"
	"errors"
	"time"

	"github.com/enjoys-in/enjoys-voice/api/internal/models"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type balanceRepo struct {
	db *gorm.DB
}

func NewBalanceRepository(db *gorm.DB) BalanceRepository {
	return &balanceRepo{db: db}
}

func (r *balanceRepo) Get(ctx context.Context, ext string) (*models.UserBalance, error) {
	var bal models.UserBalance
	err := r.db.WithContext(ctx).First(&bal, "extension = ?", ext).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		// A wallet that has never been funded reads as an empty zero balance
		// rather than an error — callers treat "no row" and "0" identically.
		return &models.UserBalance{Extension: ext, Balance: 0, Currency: ""}, nil
	}
	if err != nil {
		return nil, err
	}
	return &bal, nil
}

func (r *balanceRepo) Credit(ctx context.Context, ext string, amount float64, currency, reason, callID string) (*models.UserBalance, error) {
	var result models.UserBalance
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// Idempotency: a non-empty callID makes the charge apply at most once.
		if callID != "" {
			var existing int64
			if err := tx.Model(&models.BalanceTxn{}).
				Where("call_id = ? AND reason = ?", callID, reason).
				Count(&existing).Error; err != nil {
				return err
			}
			if existing > 0 {
				// Already applied — return the current wallet untouched.
				return tx.First(&result, "extension = ?", ext).Error
			}
		}

		// Lock the wallet row (or create it) so concurrent credits serialise.
		var bal models.UserBalance
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			First(&bal, "extension = ?", ext).Error; err != nil {
			if !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
			bal = models.UserBalance{Extension: ext, Balance: 0, Currency: currency}
			if err := tx.Create(&bal).Error; err != nil {
				return err
			}
		}

		bal.Balance += amount
		if bal.Currency == "" {
			bal.Currency = currency
		}
		bal.UpdatedAt = time.Now()
		if err := tx.Save(&bal).Error; err != nil {
			return err
		}

		txnCurrency := bal.Currency
		if txnCurrency == "" {
			txnCurrency = currency
		}
		if err := tx.Create(&models.BalanceTxn{
			Extension: ext,
			Amount:    amount,
			Currency:  txnCurrency,
			Reason:    reason,
			CallID:    callID,
		}).Error; err != nil {
			return err
		}

		result = bal
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &result, nil
}

func (r *balanceRepo) ListTxns(ctx context.Context, ext string, limit int) ([]models.BalanceTxn, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	var txns []models.BalanceTxn
	err := r.db.WithContext(ctx).
		Where("extension = ?", ext).
		Order("created_at desc").
		Limit(limit).
		Find(&txns).Error
	return txns, err
}
