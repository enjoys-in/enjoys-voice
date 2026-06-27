package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Port          string
	DatabaseURL   string
	ValkeyAddr    string
	ValkeyPass    string
	ValkeyDB      int
	JWTSecret     string
	JWTIssuer     string
	AccessTTL     time.Duration
	RefreshTTL    time.Duration
	UploadDir     string
	VoicemailDir  string
	MigrationsDir string
	// FFmpegPath is the ffmpeg binary used to normalize IVR sound uploads to the
	// FreeSWITCH-canonical format. Defaults to "ffmpeg" (resolved on PATH); a
	// sidecar/installed ffmpeg satisfies it. Empty disables IVR transcoding.
	FFmpegPath string
	// IvrDir is where normalized IVR prompts (.wav) are written. It must be on a
	// volume the FreeSWITCH container can read (IVR prompts are played server-side
	// by FS), so it is configured separately from UploadDir (browser-fetched tunes).
	IvrDir string
	Sip    SipConfig
	Cookie CookieConfig
	Twilio TwilioConfig
	// Billing holds the prepaid-wallet settings shared with the Node engine
	// (which owns the call-path debit). Both read the same env so they agree on
	// whether prepaid is on and which currency the workspace uses.
	Billing BillingConfig
	// AdminExtensions is the allow-list of extensions permitted to perform admin
	// billing operations (top-ups, reading another user's wallet). There is no
	// role column in this schema, so admin identity is configured here. Empty =
	// no admins, which denies every admin-only endpoint (safe default).
	AdminExtensions []string
	// OTPDevEcho, when true, logs generated OTP codes to the server console
	// instead of requiring a live SMS gateway. It NEVER returns the code in an
	// HTTP response. Intended for local development only; leave false in prod.
	OTPDevEcho bool
	// CallerIDVerifyTTL is how long a provider-verified outbound caller ID stays
	// valid before the user must re-verify. The Go status API and the Node SQL
	// gate both read the same window (CALLER_ID_VERIFY_TTL_DAYS) so they agree on
	// when a verification has gone stale. Zero disables expiry.
	CallerIDVerifyTTL time.Duration
}

// BillingConfig controls the prepaid wallet. When PrepaidEnabled is false the
// wallet UI is hidden, top-ups are rejected and the Node engine applies no
// pre-call gate or debit — billing is purely informational (rating still runs).
type BillingConfig struct {
	PrepaidEnabled bool
	Currency       string
}

// TwilioConfig holds Twilio REST credentials used for provider-native outbound
// caller-ID verification (the Outgoing Caller IDs / Validation Requests API)
// and for sending OTP SMS (the Messages API). An empty AccountSID disables the
// BYON caller-ID feature; an empty SMSFrom disables OTP delivery over Twilio.
type TwilioConfig struct {
	AccountSID string
	AuthToken  string
	// SMSFrom is the sender used for OTP texts: either a Twilio phone number in
	// E.164 (+1...) or a Messaging Service SID (starts with "MG"). Empty disables
	// SMS sending (OTP endpoints then return 503 unless OTP_DEV_ECHO is set).
	SMSFrom string
}

// CookieConfig controls the auth cookies set on login/signup/refresh. The
// access + refresh tokens are also mirrored into httpOnly cookies so the
// browser can authenticate with `credentials: "include"` without JS handling
// the token. Secure should be true in production (HTTPS); SameSite is "lax"
// for same-site dev and should be "none" (with Secure) for cross-site setups.
type CookieConfig struct {
	Secure        bool
	Domain        string
	SameSite      string
	AccessMaxAge  int // seconds
	RefreshMaxAge int // seconds
}

// SipConfig holds the values returned to the browser in the login response so
// the SIP.js client knows where to connect. Mirrors the Node config env vars.
type SipConfig struct {
	Domain         string
	PublicIP       string
	WsPort         string
	SipWsPort      string
	PublicWsURL    string
	PublicSipWsURL string
	TrunkEnabled   bool
}

// WsURL is the app WebSocket URL (signaling). Prefers the full-URL override.
func (s SipConfig) WsURL() string {
	if s.PublicWsURL != "" {
		return s.PublicWsURL
	}
	return fmt.Sprintf("ws://%s:%s", s.PublicIP, s.WsPort)
}

// SipWsURL is the SIP-over-WebSocket URL. Prefers the full-URL override.
func (s SipConfig) SipWsURL() string {
	if s.PublicSipWsURL != "" {
		return s.PublicSipWsURL
	}
	return fmt.Sprintf("ws://%s:%s", s.PublicIP, s.SipWsPort)
}

func Load() *Config {
	return &Config{
		// 3003 by default: Node already owns 3001 (HTTP) and 3002 (WS) during
		// the migration, so the Go API listens on the next free port.
		Port:          getEnv("PORT", "3003"),
		DatabaseURL:   getEnv("DATABASE_URL", "postgres://postgres:postgres@localhost:5432/postgres?sslmode=disable"),
		ValkeyAddr:    getEnv("VALKEY_ADDR", "localhost:6379"),
		ValkeyPass:    getEnv("VALKEY_PASSWORD", ""),
		ValkeyDB:      getEnvInt("VALKEY_DB", 0),
		JWTSecret:     getEnv("JWT_SECRET", "enjoys-voice-secret-change-me"),
		JWTIssuer:     getEnv("JWT_ISSUER", "enjoys-voice"),
		AccessTTL:     getEnvDuration("ACCESS_TOKEN_TTL", 24*time.Hour),
		RefreshTTL:    getEnvDuration("REFRESH_TOKEN_TTL", 30*24*time.Hour),
		UploadDir:     getEnv("UPLOAD_DIR", "./uploads/sounds"),
		VoicemailDir:  getEnv("VOICEMAIL_DIR", "./recordings/voicemail"),
		MigrationsDir: getEnv("MIGRATIONS_DIR", "migrations"),
		FFmpegPath:    getEnv("FFMPEG_PATH", "ffmpeg"),
		// Default under uploads so a single bind mount can expose both; override
		// IVR_SOUND_DIR to a path shared with the FreeSWITCH container in prod.
		IvrDir: getEnv("IVR_SOUND_DIR", "./uploads/ivr"),
		Cookie: CookieConfig{
			Secure:        getEnvBool("COOKIE_SECURE", false),
			Domain:        getEnv("COOKIE_DOMAIN", ""),
			SameSite:      getEnv("COOKIE_SAMESITE", "lax"),
			AccessMaxAge:  int(getEnvDuration("ACCESS_TOKEN_TTL", 24*time.Hour).Seconds()),
			RefreshMaxAge: int(getEnvDuration("REFRESH_TOKEN_TTL", 30*24*time.Hour).Seconds()),
		},
		Sip: SipConfig{
			// SIP realm/URI domain (the @host in sip:<ext>@<domain>). A dedicated
			// SIP_DOMAIN lets the SIP realm differ from the app DOMAIN; falls back
			// to DOMAIN, then localhost, so existing single-DOMAIN deploys are unchanged.
			Domain:         getEnv("SIP_DOMAIN", getEnv("DOMAIN", "localhost")),
			PublicIP:       getEnv("PUBLIC_IP", "127.0.0.1"),
			WsPort:         getEnv("WS_PORT", "3002"),
			SipWsPort:      getEnv("SIP_WS_PORT", "5065"),
			PublicWsURL:    getEnv("PUBLIC_WS_URL", ""),
			PublicSipWsURL: getEnv("PUBLIC_SIP_WS_URL", ""),
			TrunkEnabled:   os.Getenv("TRUNK_HOST") != "",
		},
		Twilio: TwilioConfig{
			AccountSID: getEnv("TWILIO_ACCOUNT_SID", ""),
			AuthToken:  getEnv("TWILIO_AUTH_TOKEN", ""),
			SMSFrom:    getEnv("TWILIO_SMS_FROM", ""),
		},
		Billing: BillingConfig{
			PrepaidEnabled: getEnvBool("BILLING_PREPAID_ENABLED", false),
			Currency:       getEnv("BILLING_CURRENCY", "USD"),
		},
		AdminExtensions: getEnvList("ADMIN_EXTENSIONS"),
		OTPDevEcho:      getEnvBool("OTP_DEV_ECHO", false),
		// Days a verified caller ID stays fresh; 0 disables expiry. Converted to a
		// duration here so the service can compare against caller_id_verified_at.
		CallerIDVerifyTTL: time.Duration(getEnvInt("CALLER_ID_VERIFY_TTL_DAYS", 90)) * 24 * time.Hour,
	}
}

func getEnvDuration(key string, fallback time.Duration) time.Duration {
	if v := os.Getenv(key); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
	}
	return fallback
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getEnvInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return fallback
}

func getEnvBool(key string, fallback bool) bool {
	if v := os.Getenv(key); v != "" {
		if b, err := strconv.ParseBool(v); err == nil {
			return b
		}
	}
	return fallback
}

// getEnvList splits a comma-separated env var into a trimmed, non-empty slice.
func getEnvList(key string) []string {
	raw := os.Getenv(key)
	if raw == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if v := strings.TrimSpace(p); v != "" {
			out = append(out, v)
		}
	}
	return out
}
