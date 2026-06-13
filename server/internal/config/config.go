package config

import (
	"fmt"
	"os"
	"strconv"
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
	Sip           SipConfig
	Cookie        CookieConfig
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
		Cookie: CookieConfig{
			Secure:        getEnvBool("COOKIE_SECURE", false),
			Domain:        getEnv("COOKIE_DOMAIN", ""),
			SameSite:      getEnv("COOKIE_SAMESITE", "lax"),
			AccessMaxAge:  int(getEnvDuration("ACCESS_TOKEN_TTL", 24*time.Hour).Seconds()),
			RefreshMaxAge: int(getEnvDuration("REFRESH_TOKEN_TTL", 30*24*time.Hour).Seconds()),
		},
		Sip: SipConfig{
			Domain:         getEnv("DOMAIN", "localhost"),
			PublicIP:       getEnv("PUBLIC_IP", "127.0.0.1"),
			WsPort:         getEnv("WS_PORT", "3002"),
			SipWsPort:      getEnv("SIP_WS_PORT", "5065"),
			PublicWsURL:    getEnv("PUBLIC_WS_URL", ""),
			PublicSipWsURL: getEnv("PUBLIC_SIP_WS_URL", ""),
			TrunkEnabled:   os.Getenv("TRUNK_HOST") != "",
		},
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
