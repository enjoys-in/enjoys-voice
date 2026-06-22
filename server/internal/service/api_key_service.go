package service

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"

	"github.com/enjoys-in/enjoys-voice/api/internal/models"
	"github.com/enjoys-in/enjoys-voice/api/internal/repository"
	"gorm.io/gorm"
)

type apiKeyService struct {
	repo repository.APIKeyRepository
}

func NewAPIKeyService(repo repository.APIKeyRepository) APIKeyService {
	return &apiKeyService{repo: repo}
}

func (s *apiKeyService) List(ctx context.Context, owner string) ([]models.APIKeyResponse, error) {
	keys, err := s.repo.ListByOwner(ctx, owner)
	if err != nil {
		return nil, err
	}
	out := make([]models.APIKeyResponse, 0, len(keys))
	for i := range keys {
		out = append(out, keys[i].ToResponse())
	}
	return out, nil
}

func (s *apiKeyService) Create(ctx context.Context, owner string, input *APIKeyInput) (*models.APIKeyResponse, error) {
	if input == nil || input.DestinationNumber == nil || strings.TrimSpace(*input.DestinationNumber) == "" {
		return nil, ErrAPIKeyInvalid
	}

	key := &models.APIKey{OwnerExtension: owner, Active: true}
	applyAPIKeyInput(key, input)
	normalizeAPIKey(key)

	// Publishable identifier (safe for browser code) + a one-time secret for
	// server-to-server use. The secret is a high-entropy random token, so it is
	// stored as a plain SHA-256 hash (not bcrypt): brute-forcing 192 random bits
	// is infeasible, and a fast hash lets the Node engine verify it too.
	key.PublicKey = "pk_live_" + randomToken(16)
	secret := "sk_live_" + randomToken(24)
	key.SecretHash = sha256Hex(secret)

	if err := s.repo.Create(ctx, key); err != nil {
		return nil, err
	}
	resp := key.ToResponse()
	resp.Secret = secret // shown exactly once
	return &resp, nil
}

func (s *apiKeyService) Update(ctx context.Context, owner string, id uint, input *APIKeyInput) (*models.APIKeyResponse, error) {
	key, err := s.ownedKey(ctx, owner, id)
	if err != nil {
		return nil, err
	}
	applyAPIKeyInput(key, input)
	normalizeAPIKey(key)
	if strings.TrimSpace(key.DestinationNumber) == "" {
		return nil, ErrAPIKeyInvalid
	}
	if err := s.repo.Update(ctx, key); err != nil {
		return nil, err
	}
	resp := key.ToResponse()
	return &resp, nil
}

func (s *apiKeyService) Delete(ctx context.Context, owner string, id uint) error {
	if _, err := s.ownedKey(ctx, owner, id); err != nil {
		return err
	}
	return s.repo.Delete(ctx, id)
}

// ownedKey fetches a key and enforces ownership, mapping a missing row OR a
// foreign owner to ErrAPIKeyNotFound (so a caller can't probe others' key ids).
func (s *apiKeyService) ownedKey(ctx context.Context, owner string, id uint) (*models.APIKey, error) {
	key, err := s.repo.Get(ctx, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrAPIKeyNotFound
		}
		return nil, err
	}
	if key.OwnerExtension != owner {
		return nil, ErrAPIKeyNotFound
	}
	return key, nil
}

// applyAPIKeyInput copies the non-nil fields of input onto key (partial update).
func applyAPIKeyInput(k *models.APIKey, in *APIKeyInput) {
	if in == nil {
		return
	}
	if in.Label != nil {
		k.Label = *in.Label
	}
	if in.AllowedOrigins != nil {
		k.AllowedOrigins = joinCSV(*in.AllowedOrigins)
	}
	if in.AllowedIPs != nil {
		k.AllowedIPs = joinCSV(*in.AllowedIPs)
	}
	if in.DestinationNumber != nil {
		k.DestinationNumber = *in.DestinationNumber
	}
	if in.CallerID != nil {
		k.CallerID = *in.CallerID
	}
	if in.DailyCap != nil {
		k.DailyCap = *in.DailyCap
	}
	if in.Active != nil {
		k.Active = *in.Active
	}
}

func normalizeAPIKey(k *models.APIKey) {
	k.DestinationNumber = strings.TrimSpace(k.DestinationNumber)
	k.CallerID = strings.TrimSpace(k.CallerID)
	k.Label = strings.TrimSpace(k.Label)
	if k.DailyCap < 0 {
		k.DailyCap = 0
	}
}

// joinCSV trims each entry and joins with commas, dropping empties.
func joinCSV(items []string) string {
	cleaned := make([]string, 0, len(items))
	for _, it := range items {
		if v := strings.TrimSpace(it); v != "" {
			cleaned = append(cleaned, v)
		}
	}
	return strings.Join(cleaned, ",")
}

// randomToken returns n random bytes as a lowercase hex string (length 2n).
func randomToken(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		// crypto/rand failing is catastrophic; surface a clearly-invalid token.
		return "ERR"
	}
	return hex.EncodeToString(b)
}

// sha256Hex returns the lowercase hex SHA-256 of s.
func sha256Hex(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}
