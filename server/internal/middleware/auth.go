package middleware

import (
	"strings"

	"github.com/enjoys-in/enjoys-voice/api/internal/response"
	"github.com/enjoys-in/enjoys-voice/api/internal/token"
	"github.com/gin-gonic/gin"
)

func AuthMiddleware(tm *token.Manager) gin.HandlerFunc {
	return func(c *gin.Context) {
		raw := bearerToken(c)
		if raw == "" {
			// Fall back to the httpOnly cookie set on login (credentials flow).
			if cookie, err := c.Cookie("token"); err == nil {
				raw = cookie
			}
		}
		if raw == "" {
			response.Unauthorized(c, "Missing authorization header")
			c.Abort()
			return
		}

		claims, err := tm.Parse(raw)
		if err != nil {
			response.Unauthorized(c, "Invalid token")
			c.Abort()
			return
		}

		if claims.Type != token.TypeAccess {
			response.Unauthorized(c, "Invalid token type")
			c.Abort()
			return
		}

		c.Set("extension", claims.Extension)
		c.Set("user_id", claims.UserID)
		c.Next()
	}
}

// bearerToken extracts the token from an "Authorization: Bearer <token>" header.
// Returns "" when the header is absent or malformed.
func bearerToken(c *gin.Context) string {
	authHeader := c.GetHeader("Authorization")
	if authHeader == "" {
		return ""
	}
	parts := strings.SplitN(authHeader, " ", 2)
	if len(parts) != 2 || strings.ToLower(parts[0]) != "bearer" {
		return ""
	}
	return parts[1]
}
