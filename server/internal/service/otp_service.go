package service

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"fmt"
	"log"
	"math/big"
	"strconv"
	"strings"
	"time"

	"github.com/enjoys-in/enjoys-voice/api/internal/cache"
	"github.com/enjoys-in/enjoys-voice/api/internal/models"
	"github.com/enjoys-in/enjoys-voice/api/internal/repository"
	"github.com/enjoys-in/enjoys-voice/api/internal/twilio"
)

const (
	otpTTL         = 5 * time.Minute  // how long a code stays valid
	otpCooldown    = 60 * time.Second // min gap between code requests
	otpMaxAttempts = 5                // wrong tries before a code is burned
	otpDigits      = 6
)

type otpService struct {
	auth     AuthService
	userRepo repository.UserRepository
	sms      *twilio.Client
	cache    cache.Cache
	devEcho  bool
}

// NewOTPService builds the OTP service. sms delivers codes (when configured);
// devEcho logs codes to the console for local development when no gateway is
// set up. auth is reused so signup-via-OTP shares the exact account-creation
// logic (extension generation, default settings, cache warming).
func NewOTPService(auth AuthService, ur repository.UserRepository, sms *twilio.Client, c cache.Cache, devEcho bool) OTPService {
	return &otpService{auth: auth, userRepo: ur, sms: sms, cache: c, devEcho: devEcho}
}

func otpCodeKey(purpose, mobile string) string     { return "otp:" + purpose + ":" + mobile }
func otpAttemptsKey(purpose, mobile string) string { return "otp:att:" + purpose + ":" + mobile }
func otpCooldownKey(purpose, mobile string) string { return "otp:cd:" + purpose + ":" + mobile }

// smsAvailable reports whether a code can actually be delivered (real gateway
// or the dev console echo). Used to keep both login branches (existing vs not)
// returning the same 503 when delivery is impossible, avoiding enumeration.
func (s *otpService) smsAvailable() bool {
	return s.sms.SMSEnabled() || s.devEcho
}

// genCode returns a zero-padded numeric OTP of otpDigits length using crypto/rand.
func genCode() (string, error) {
	max := big.NewInt(1)
	for i := 0; i < otpDigits; i++ {
		max.Mul(max, big.NewInt(10))
	}
	n, err := rand.Int(rand.Reader, max)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%0*d", otpDigits, n.Int64()), nil
}

// e164 ensures a leading "+" for SMS delivery (stored mobiles may omit it).
func e164(mobile string) string {
	if strings.HasPrefix(mobile, "+") {
		return mobile
	}
	return "+" + mobile
}

// issue generates, stores and sends a code for (purpose, mobile), enforcing the
// per-number cooldown. It is the single place codes are minted.
func (s *otpService) issue(ctx context.Context, purpose, mobile string) error {
	if !s.smsAvailable() {
		return ErrOTPUnavailable
	}
	if exists, _ := s.cache.Exists(ctx, otpCooldownKey(purpose, mobile)); exists {
		return ErrOTPCooldown
	}

	code, err := genCode()
	if err != nil {
		return err
	}
	if err := s.cache.Set(ctx, otpCodeKey(purpose, mobile), code, otpTTL); err != nil {
		return err
	}
	_ = s.cache.Del(ctx, otpAttemptsKey(purpose, mobile)) // reset attempts for the new code

	if err := s.send(ctx, mobile, code); err != nil {
		_ = s.cache.Del(ctx, otpCodeKey(purpose, mobile))
		return err
	}

	// Start the cooldown only after a successful send.
	_ = s.cache.Set(ctx, otpCooldownKey(purpose, mobile), "1", otpCooldown)
	return nil
}

// send delivers the code via the SMS gateway, or logs it to the console when
// running with OTP_DEV_ECHO and no gateway. The code is never returned to the
// client.
func (s *otpService) send(ctx context.Context, mobile, code string) error {
	body := fmt.Sprintf("Your verification code is %s. It expires in 5 minutes.", code)
	if s.sms.SMSEnabled() {
		return s.sms.SendSMS(ctx, e164(mobile), body)
	}
	if s.devEcho {
		log.Printf("[otp] dev echo — code for %s: %s", mobile, code)
		return nil
	}
	return ErrOTPUnavailable
}

// verify checks a submitted code in constant time, burning it on success and
// enforcing a max-attempts cap to bound brute force within the TTL window.
func (s *otpService) verify(ctx context.Context, purpose, mobile, code string) error {
	stored, _ := s.cache.Get(ctx, otpCodeKey(purpose, mobile))
	if stored == "" {
		return ErrOTPInvalid // none issued or expired
	}

	attemptsKey := otpAttemptsKey(purpose, mobile)
	attempts := 0
	if v, _ := s.cache.Get(ctx, attemptsKey); v != "" {
		attempts, _ = strconv.Atoi(v)
	}
	if attempts >= otpMaxAttempts {
		_ = s.cache.Del(ctx, otpCodeKey(purpose, mobile), attemptsKey)
		return ErrOTPInvalid
	}

	if subtle.ConstantTimeCompare([]byte(stored), []byte(strings.TrimSpace(code))) != 1 {
		_ = s.cache.Set(ctx, attemptsKey, strconv.Itoa(attempts+1), otpTTL)
		return ErrOTPInvalid
	}

	// Success: burn the code and clear related keys.
	_ = s.cache.Del(ctx, otpCodeKey(purpose, mobile), attemptsKey, otpCooldownKey(purpose, mobile))
	return nil
}

func (s *otpService) RequestSignupOTP(ctx context.Context, mobile string) error {
	m := normalizeMobile(mobile)
	if existing, _ := s.userRepo.GetByMobile(ctx, m); existing != nil {
		return ErrMobileRegistered
	}
	return s.issue(ctx, "signup", m)
}

func (s *otpService) VerifySignupOTP(ctx context.Context, name, mobile, password, code string) (*models.User, error) {
	m := normalizeMobile(mobile)
	if err := s.verify(ctx, "signup", m, code); err != nil {
		return nil, err
	}
	// Account creation (extension, default settings, cache warming) lives in one
	// place. Signup re-checks the number, so a race that registered it between
	// request and verify surfaces as its "already registered" error.
	user, err := s.auth.Signup(ctx, name, mobile, password)
	if err != nil {
		if strings.Contains(err.Error(), "already registered") {
			return nil, ErrMobileRegistered
		}
		return nil, err
	}
	return user, nil
}

func (s *otpService) RequestLoginOTP(ctx context.Context, mobile string) error {
	// Gate on delivery first so a missing gateway returns the same 503 whether
	// or not the number has an account (no enumeration via error codes).
	if !s.smsAvailable() {
		return ErrOTPUnavailable
	}
	m := normalizeMobile(mobile)
	user, _ := s.userRepo.GetByMobile(ctx, m)
	if user == nil {
		return nil // report success but send nothing
	}
	return s.issue(ctx, "login", m)
}

func (s *otpService) VerifyLoginOTP(ctx context.Context, mobile, code string) (*models.User, error) {
	m := normalizeMobile(mobile)
	if err := s.verify(ctx, "login", m, code); err != nil {
		return nil, err
	}
	user, err := s.userRepo.GetByMobile(ctx, m)
	if err != nil || user == nil {
		return nil, ErrOTPInvalid
	}
	return user, nil
}
