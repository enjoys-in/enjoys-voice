package cache

import (
	"context"
	"time"
)

// Cache is the interface for all cache operations.
// Node.js SIP server reads from the same cache using the key format.
type Cache interface {
	Get(ctx context.Context, key string) (string, error)
	Set(ctx context.Context, key string, value string, ttl time.Duration) error
	Del(ctx context.Context, keys ...string) error
	Exists(ctx context.Context, key string) (bool, error)
}

// Key format conventions (shared with Node.js):
//   settings:{ext}     → JSON of SettingsResponse
//   blocked:{ext}      → JSON array of blocked numbers
//   forwarding:{ext}   → JSON of ForwardingResponse
//   user:{ext}         → JSON of user profile
//   sounds:{ext}       → JSON array of user sounds

const (
	KeySettings   = "settings:"
	KeyBlocked    = "blocked:"
	KeyForwarding = "forwarding:"
	KeyUser       = "user:"
	KeySounds     = "sounds:"

	DefaultTTL = 24 * time.Hour
)

func SettingsKey(ext string) string   { return KeySettings + ext }
func BlockedKey(ext string) string    { return KeyBlocked + ext }
func ForwardingKey(ext string) string { return KeyForwarding + ext }
func UserKey(ext string) string       { return KeyUser + ext }
func SoundsKey(ext string) string     { return KeySounds + ext }
