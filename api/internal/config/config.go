package config

import (
	"os"
	"strconv"
)

type Config struct {
	Port         string
	DatabaseURL  string
	ValkeyAddr   string
	ValkeyPass   string
	ValkeyDB     int
	JWTSecret    string
	UploadDir    string
	VoicemailDir string
}

func Load() *Config {
	return &Config{
		// 3003 by default: Node already owns 3001 (HTTP) and 3002 (WS) during
		// the migration, so the Go API listens on the next free port.
		Port:         getEnv("PORT", "3003"),
		DatabaseURL:  getEnv("DATABASE_URL", "postgres://postgres:postgres@localhost:5432/postgres?sslmode=disable"),
		ValkeyAddr:   getEnv("VALKEY_ADDR", "localhost:6379"),
		ValkeyPass:   getEnv("VALKEY_PASSWORD", ""),
		ValkeyDB:     getEnvInt("VALKEY_DB", 0),
		JWTSecret:    getEnv("JWT_SECRET", "enjoys-voice-secret-change-me"),
		UploadDir:    getEnv("UPLOAD_DIR", "./uploads/sounds"),
		VoicemailDir: getEnv("VOICEMAIL_DIR", "./recordings/voicemail"),
	}
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
