package cache

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
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
	KeyIvr        = "ivr:"

	DefaultTTL = 24 * time.Hour
)

func SettingsKey(ext string) string   { return KeySettings + ext }
func BlockedKey(ext string) string    { return KeyBlocked + ext }
func ForwardingKey(ext string) string { return KeyForwarding + ext }
func UserKey(ext string) string       { return KeyUser + ext }
func SoundsKey(ext string) string     { return KeySounds + ext }

// IvrKey is the shared Redis key for a flow's cached graph. The entry extension
// is globally unique (one flow per extension), so a short SHA-256 hash of it is a
// unique, fixed-length key that never collides across users — two users can never
// both own 6000. The Node SIP runtime derives the SAME key from the dialed number,
// so a Del here invalidates its cache.
func IvrKey(ext string) string {
	sum := sha256.Sum256([]byte(ext))
	return KeyIvr + hex.EncodeToString(sum[:8]) // 8 bytes = 16 hex chars
}
