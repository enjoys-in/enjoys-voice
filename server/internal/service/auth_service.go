package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
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

// normalizeMobile strips spaces and dashes from a phone number so the same
// input always maps to one stored value (and one OTP cache key). Signup stores
// numbers in this form, so login lookups and OTP keys must use it too.
func normalizeMobile(mobile string) string {
	n := strings.ReplaceAll(mobile, " ", "")
	return strings.ReplaceAll(n, "-", "")
}

func (s *authService) Login(ctx context.Context, username, password string) (*models.User, error) {
	user, err := s.userRepo.GetByUsername(ctx, username)
	if err != nil {
		// Try by extension
		user, err = s.userRepo.GetByExtension(ctx, username)
		if err != nil {
			// Try by phone number (mobile), normalized like signup
			normalized := normalizeMobile(username)
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

// GetByExtension fetches a user by their extension. Backs the /auth/me session
// check, which the UI calls on boot to confirm a persisted login is still valid.
func (s *authService) GetByExtension(ctx context.Context, ext string) (*models.User, error) {
	return s.userRepo.GetByExtension(ctx, ext)
}

// UpdateName changes the display name of the user identified by ext, then
// re-warms the cached profile so /auth/me and lookups reflect it immediately.
// Backs PATCH /auth/me (self-service rename); ext always comes from the token.
func (s *authService) UpdateName(ctx context.Context, ext, name string) (*models.User, error) {
	if err := s.userRepo.UpdateName(ctx, ext, name); err != nil {
		return nil, err
	}
	user, err := s.userRepo.GetByExtension(ctx, ext)
	if err != nil {
		return nil, err
	}
	s.warmUserCache(ctx, user)
	return user, nil
}

func (s *authService) Signup(ctx context.Context, name, mobile, password string) (*models.User, error) {
	normalized := normalizeMobile(mobile)

	// Check existing
	if existing, _ := s.userRepo.GetByMobile(ctx, normalized); existing != nil {
		return nil, errors.New("phone number already registered")
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return nil, fmt.Errorf("failed to hash password: %w", err)
	}

	// Generate extension from last 7 digits, guaranteeing it's free so signup
	// can't fail on a username/extension collision (two numbers can share their
	// trailing digits, e.g. across country codes).
	ext := s.uniqueExtension(ctx, normalized)

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

// uniqueExtension derives the signup extension from the mobile (generateExtension
// uses the last 7 digits) and guarantees it is free. Because the extension also
// becomes the user's unique username, a naive collision would fail signup with a
// confusing "failed to create user" error even though the phone number itself is
// new. On collision we probe for the next free extension of the same width so a
// valid signup always succeeds.
func (s *authService) uniqueExtension(ctx context.Context, mobile string) string {
	base := generateExtension(mobile)
	if _, err := s.userRepo.GetByExtension(ctx, base); err != nil {
		return base // not found → free
	}
	n, err := strconv.Atoi(base)
	if err != nil {
		return base // non-numeric base shouldn't happen; let Create surface it
	}
	width := len(base)
	mod := 1
	for i := 0; i < width; i++ {
		mod *= 10
	}
	// Probe a bounded number of successors (wrapping within the same digit width)
	// for a free extension. Collisions are rare, so a small cap is plenty.
	for i := 1; i <= 1000 && i < mod; i++ {
		cand := fmt.Sprintf("%0*d", width, (n+i)%mod)
		if _, err := s.userRepo.GetByExtension(ctx, cand); err != nil {
			return cand // free
		}
	}
	return base // exhausted probes; Create will surface the unique violation
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
