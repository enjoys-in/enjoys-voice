package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/enjoys-in/enjoys-voice/api/internal/cache"
	"github.com/enjoys-in/enjoys-voice/api/internal/models"
	"github.com/enjoys-in/enjoys-voice/api/internal/repository"
	"golang.org/x/crypto/bcrypt"
)

type authService struct {
	userRepo     repository.UserRepository
	settingsRepo repository.SettingsRepository
	cache        cache.Cache
}

func NewAuthService(ur repository.UserRepository, sr repository.SettingsRepository, c cache.Cache) AuthService {
	return &authService{userRepo: ur, settingsRepo: sr, cache: c}
}

func (s *authService) Login(ctx context.Context, username, password string) (*models.User, error) {
	user, err := s.userRepo.GetByUsername(ctx, username)
	if err != nil {
		// Try by extension
		user, err = s.userRepo.GetByExtension(ctx, username)
		if err != nil {
			// Try by phone number (mobile), normalized like signup
			normalized := strings.ReplaceAll(username, " ", "")
			normalized = strings.ReplaceAll(normalized, "-", "")
			user, err = s.userRepo.GetByMobile(ctx, normalized)
			if err != nil {
				return nil, errors.New("invalid credentials")
			}
		}
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(password)); err != nil {
		return nil, errors.New("invalid credentials")
	}

	// Warm cache on login
	go s.warmUserCache(context.Background(), user)

	return user, nil
}

func (s *authService) Signup(ctx context.Context, name, mobile, password string) (*models.User, error) {
	normalized := strings.ReplaceAll(mobile, " ", "")
	normalized = strings.ReplaceAll(normalized, "-", "")

	// Check existing
	if existing, _ := s.userRepo.GetByMobile(ctx, normalized); existing != nil {
		return nil, errors.New("phone number already registered")
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return nil, fmt.Errorf("failed to hash password: %w", err)
	}

	// Generate extension from last 7 digits
	ext := generateExtension(normalized)

	user := &models.User{
		Extension: ext,
		Username:  ext,
		Name:      name,
		Mobile:    normalized,
		Password:  string(hash),
	}

	if err := s.userRepo.Create(ctx, user); err != nil {
		return nil, fmt.Errorf("failed to create user: %w", err)
	}

	// Create default settings
	settings := &models.UserSettings{
		UserID:          user.ID,
		Extension:       user.Extension,
		SoundsEnabled:   true,
		DtmfEnabled:     true,
		CallerTune:      "caller_tune.wav",
		Ringtone:        "ringtone.wav",
		PstnCountryCode: "+91",
	}
	_ = s.settingsRepo.Upsert(ctx, settings)

	// Warm cache
	go s.warmUserCache(context.Background(), user)

	return user, nil
}

func (s *authService) warmUserCache(ctx context.Context, user *models.User) {
	data, _ := json.Marshal(map[string]string{
		"extension": user.Extension,
		"name":      user.Name,
		"mobile":    user.Mobile,
		"username":  user.Username,
	})
	_ = s.cache.Set(ctx, cache.UserKey(user.Extension), string(data), cache.DefaultTTL)

	// Also warm settings
	settings, err := s.settingsRepo.Get(ctx, user.Extension)
	if err == nil {
		resp := settings.ToResponse()
		sData, _ := json.Marshal(resp)
		_ = s.cache.Set(ctx, cache.SettingsKey(user.Extension), string(sData), cache.DefaultTTL)
	}
}

func generateExtension(mobile string) string {
	digits := ""
	for _, c := range mobile {
		if c >= '0' && c <= '9' {
			digits += string(c)
		}
	}
	// Extension must always be 5-7 digits: cap long numbers at the last 7
	// digits and left-pad short ones with zeros up to 5.
	if len(digits) > 7 {
		digits = digits[len(digits)-7:]
	}
	for len(digits) < 5 {
		digits = "0" + digits
	}
	return digits
}
