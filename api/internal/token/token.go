// Package token issues and validates the JWT access/refresh token pairs used by
// the API. Access tokens authorize protected routes (carried as a Bearer
// header); refresh tokens are long-lived and exchanged at /auth/refresh for a
// new pair. Both are signed with the same HMAC secret.
package token

import (
	"errors"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const (
	// TypeAccess authorizes protected API routes.
	TypeAccess = "access"
	// TypeRefresh is only accepted at the refresh endpoint.
	TypeRefresh = "refresh"
)

var (
	// ErrInvalid is returned when a token fails signature or expiry validation.
	ErrInvalid = errors.New("invalid token")
	// ErrWrongType is returned when a token's type does not match the expected use.
	ErrWrongType = errors.New("wrong token type")
)

// Claims is the JWT payload shared by access and refresh tokens.
type Claims struct {
	Extension string `json:"extension"`
	UserID    uint   `json:"user_id"`
	Type      string `json:"type"`
	jwt.RegisteredClaims
}

// Pair is the result of a successful login or refresh.
type Pair struct {
	AccessToken  string `json:"token"`
	RefreshToken string `json:"refreshToken"`
	// ExpiresIn is the access token lifetime in seconds.
	ExpiresIn int64 `json:"expiresIn"`
}

// Manager signs and verifies tokens with a fixed secret, issuer and TTLs.
type Manager struct {
	secret     []byte
	issuer     string
	accessTTL  time.Duration
	refreshTTL time.Duration
}

// NewManager builds a token Manager.
func NewManager(secret, issuer string, accessTTL, refreshTTL time.Duration) *Manager {
	return &Manager{
		secret:     []byte(secret),
		issuer:     issuer,
		accessTTL:  accessTTL,
		refreshTTL: refreshTTL,
	}
}

// Generate issues a fresh access + refresh pair for a user.
func (m *Manager) Generate(userID uint, extension string) (*Pair, error) {
	now := time.Now()

	access, err := m.sign(userID, extension, TypeAccess, now, m.accessTTL)
	if err != nil {
		return nil, err
	}
	refresh, err := m.sign(userID, extension, TypeRefresh, now, m.refreshTTL)
	if err != nil {
		return nil, err
	}

	return &Pair{
		AccessToken:  access,
		RefreshToken: refresh,
		ExpiresIn:    int64(m.accessTTL.Seconds()),
	}, nil
}

func (m *Manager) sign(userID uint, extension, tokenType string, now time.Time, ttl time.Duration) (string, error) {
	claims := Claims{
		Extension: extension,
		UserID:    userID,
		Type:      tokenType,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    m.issuer,
			Subject:   extension,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(ttl)),
		},
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(m.secret)
}

// Parse validates the signature and expiry, returning the claims.
func (m *Manager) Parse(tokenString string) (*Claims, error) {
	claims := &Claims{}
	tok, err := jwt.ParseWithClaims(tokenString, claims, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, jwt.ErrSignatureInvalid
		}
		return m.secret, nil
	})
	if err != nil || !tok.Valid {
		return nil, ErrInvalid
	}
	return claims, nil
}

// ParseRefresh validates a token and asserts it is a refresh token.
func (m *Manager) ParseRefresh(tokenString string) (*Claims, error) {
	claims, err := m.Parse(tokenString)
	if err != nil {
		return nil, err
	}
	if claims.Type != TypeRefresh {
		return nil, ErrWrongType
	}
	return claims, nil
}
