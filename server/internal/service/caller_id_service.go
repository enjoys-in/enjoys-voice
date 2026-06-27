package service

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/enjoys-in/enjoys-voice/api/internal/cache"
	"github.com/enjoys-in/enjoys-voice/api/internal/models"
	"github.com/enjoys-in/enjoys-voice/api/internal/repository"
	"github.com/enjoys-in/enjoys-voice/api/internal/twilio"
)

// callerIDCooldown throttles how often a user may trigger a Twilio call to
// their number (each attempt places a real phone call and costs money).
const callerIDCooldown = 60 * time.Second

var nonDigit = regexp.MustCompile(`\D`)

type callerIDService struct {
	settingsRepo repository.SettingsRepository
	userRepo     repository.UserRepository
	twilio       *twilio.Client
	cache        cache.Cache
	// verifyTTL is how long a verified caller ID stays valid before the user must
	// re-verify. Zero disables expiry. The Node SQL gate mirrors this window so an
	// expired number is never presented on a call.
	verifyTTL time.Duration
}

func NewCallerIDService(
	sr repository.SettingsRepository,
	ur repository.UserRepository,
	tw *twilio.Client,
	c cache.Cache,
	verifyTTL time.Duration,
) CallerIDService {
	return &callerIDService{settingsRepo: sr, userRepo: ur, twilio: tw, cache: c, verifyTTL: verifyTTL}
}

// toE164 builds an E.164 number from an optional country code and the raw
// number. Any existing leading + is preserved; otherwise the country code (or a
// bare +) is prefixed. Returns an error when no usable digits remain.
func toE164(countryCode, number string) (string, error) {
	raw := strings.TrimSpace(number)
	if strings.HasPrefix(raw, "+") {
		digits := nonDigit.ReplaceAllString(raw, "")
		if len(digits) < 8 {
			return "", errors.New("invalid phone number")
		}
		return "+" + digits, nil
	}

	digits := nonDigit.ReplaceAllString(raw, "")
	cc := nonDigit.ReplaceAllString(countryCode, "")
	if cc != "" {
		// Avoid double-prefixing when the number already carries the country code.
		if !strings.HasPrefix(digits, cc) {
			digits = cc + digits
		}
	}
	if len(digits) < 8 {
		return "", errors.New("invalid phone number")
	}
	return "+" + digits, nil
}

// loadOrInit returns the user's settings row, creating an in-memory one (bound
// to the user id) when none exists yet so the first verification can persist.
func (s *callerIDService) loadOrInit(ctx context.Context, ext string) (*models.UserSettings, error) {
	settings, err := s.settingsRepo.Get(ctx, ext)
	if err == nil {
		return settings, nil
	}
	user, uErr := s.userRepo.GetByExtension(ctx, ext)
	if uErr != nil {
		return nil, errors.New("user not found")
	}
	return &models.UserSettings{UserID: user.ID, Extension: ext}, nil
}

func (s *callerIDService) StartVerification(ctx context.Context, ext, number, countryCode string) (*CallerIDVerifyStart, error) {
	if !s.twilio.Enabled() {
		return nil, ErrCallerIDUnavailable
	}

	cooldownKey := "callerid:cooldown:" + ext
	if exists, _ := s.cache.Exists(ctx, cooldownKey); exists {
		return nil, ErrCallerIDCooldown
	}

	e164, err := toE164(countryCode, number)
	if err != nil {
		return nil, err
	}

	settings, err := s.loadOrInit(ctx, ext)
	if err != nil {
		return nil, err
	}

	vr, err := s.twilio.CreateValidationRequest(ctx, e164, fmt.Sprintf("Enjoys Voice ext %s", ext))
	if err != nil {
		return nil, err
	}

	// Persist the candidate number as unverified; the user must complete the
	// Twilio call before it can be presented. Storing the validation/call sid
	// lets us correlate the attempt.
	settings.OutboundCallerID = e164
	settings.CallerIDVerified = false
	settings.CallerIDVerifiedAt = nil
	settings.CallerIDValidationSid = vr.CallSID
	if err := s.settingsRepo.Upsert(ctx, settings); err != nil {
		return nil, err
	}

	s.invalidate(ctx, ext)
	_ = s.cache.Set(ctx, cooldownKey, "1", callerIDCooldown)

	return &CallerIDVerifyStart{
		Status:         "pending",
		Number:         e164,
		ValidationCode: vr.ValidationCode,
		CallSid:        vr.CallSID,
	}, nil
}

func (s *callerIDService) ConfirmVerification(ctx context.Context, ext string) (*CallerIDStatus, error) {
	if !s.twilio.Enabled() {
		return nil, ErrCallerIDUnavailable
	}

	settings, err := s.settingsRepo.Get(ctx, ext)
	if err != nil || settings.OutboundCallerID == "" {
		return nil, errors.New("no pending caller id verification")
	}

	if settings.CallerIDVerified {
		return s.statusOf(settings), nil
	}

	// Twilio only lists a number under OutgoingCallerIds once the user has
	// completed the validation call, so its presence is our source of truth.
	found, err := s.twilio.FindOutgoingCallerID(ctx, settings.OutboundCallerID)
	if err != nil {
		return nil, err
	}
	if found == nil {
		// Still pending — surface current (unverified) status.
		return s.statusOf(settings), nil
	}

	now := time.Now()
	settings.CallerIDVerified = true
	settings.CallerIDVerifiedAt = &now
	settings.CallerIDValidationSid = found.SID
	if err := s.settingsRepo.Upsert(ctx, settings); err != nil {
		return nil, err
	}
	s.invalidate(ctx, ext)

	return s.statusOf(settings), nil
}

func (s *callerIDService) Get(ctx context.Context, ext string) (*CallerIDStatus, error) {
	settings, err := s.settingsRepo.Get(ctx, ext)
	if err != nil {
		// No settings row yet → no caller id configured.
		return &CallerIDStatus{}, nil
	}
	return s.statusOf(settings), nil
}

func (s *callerIDService) Delete(ctx context.Context, ext string) error {
	settings, err := s.settingsRepo.Get(ctx, ext)
	if err != nil || settings.OutboundCallerID == "" {
		return nil // nothing to remove
	}

	// Best-effort removal of the verified resource on Twilio so the number can
	// be re-verified later or by another account.
	if s.twilio.Enabled() {
		if found, fErr := s.twilio.FindOutgoingCallerID(ctx, settings.OutboundCallerID); fErr == nil && found != nil {
			_ = s.twilio.DeleteOutgoingCallerID(ctx, found.SID)
		}
	}

	settings.OutboundCallerID = ""
	settings.CallerIDVerified = false
	settings.CallerIDVerifiedAt = nil
	settings.CallerIDValidationSid = ""
	if err := s.settingsRepo.Upsert(ctx, settings); err != nil {
		return err
	}
	s.invalidate(ctx, ext)
	return nil
}

// invalidate drops the settings cache so the next read reflects caller-ID
// changes (the settings response embeds the read-only caller-ID view).
func (s *callerIDService) invalidate(ctx context.Context, ext string) {
	_ = s.cache.Del(ctx, cache.SettingsKey(ext))
}

func statusOf(s *models.UserSettings) *CallerIDStatus {
	return &CallerIDStatus{
		Number:     s.OutboundCallerID,
		Verified:   s.CallerIDVerified,
		VerifiedAt: s.CallerIDVerifiedAt,
	}
}

// statusOf builds the API view of a settings row, applying age-based expiry: a
// verified caller ID older than verifyTTL is reported as unverified so the UI
// prompts a re-verification. No provider round-trip is involved; the Node SQL
// gate enforces the same window on the call path.
func (s *callerIDService) statusOf(settings *models.UserSettings) *CallerIDStatus {
	st := statusOf(settings)
	if s.isStale(settings) {
		st.Verified = false
	}
	return st
}

// isStale reports whether a verified caller ID has aged past verifyTTL. A zero
// TTL disables expiry. A verified row with no timestamp is treated as stale —
// we can't prove freshness, so force re-verification.
func (s *callerIDService) isStale(settings *models.UserSettings) bool {
	if s.verifyTTL <= 0 || !settings.CallerIDVerified {
		return false
	}
	if settings.CallerIDVerifiedAt == nil {
		return true
	}
	return time.Since(*settings.CallerIDVerifiedAt) > s.verifyTTL
}
