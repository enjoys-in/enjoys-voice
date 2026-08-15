package cache

import (
	"context"
	"time"

	"github.com/redis/go-redis/v9"
)

type valkeyCache struct {
	client *redis.Client
}

// NewValkeyCache creates a cache backed by Valkey (Redis-compatible). A non-empty
// url (redis:// / rediss://, optionally with an ACL username) wins; otherwise the
// client is built from addr + username + password + db.
func NewValkeyCache(url, addr, username, password string, db int) (Cache, error) {
	var opts *redis.Options
	if url != "" {
		parsed, err := redis.ParseURL(url)
		if err != nil {
			return nil, err
		}
		opts = parsed
	} else {
		opts = &redis.Options{
			Addr:     addr,
			Username: username,
			Password: password,
			DB:       db,
		}
	}
	client := redis.NewClient(opts)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := client.Ping(ctx).Err(); err != nil {
		return nil, err
	}

	return &valkeyCache{client: client}, nil
}

func (c *valkeyCache) Get(ctx context.Context, key string) (string, error) {
	val, err := c.client.Get(ctx, key).Result()
	if err == redis.Nil {
		return "", nil
	}
	return val, err
}

func (c *valkeyCache) Set(ctx context.Context, key string, value string, ttl time.Duration) error {
	return c.client.Set(ctx, key, value, ttl).Err()
}

func (c *valkeyCache) Del(ctx context.Context, keys ...string) error {
	return c.client.Del(ctx, keys...).Err()
}

func (c *valkeyCache) Exists(ctx context.Context, key string) (bool, error) {
	n, err := c.client.Exists(ctx, key).Result()
	return n > 0, err
}
