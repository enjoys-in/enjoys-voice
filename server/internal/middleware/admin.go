package middleware

import (
	"net/http"

	"github.com/enjoys-in/enjoys-voice/api/internal/response"
	"github.com/gin-gonic/gin"
)

// AdminSet builds a lookup set from the configured ADMIN_EXTENSIONS allow-list
// (blank entries skipped). There is no role column in this codebase — admin
// identity is purely this allow-list. An empty set means "no admins", so every
// admin-only endpoint is denied (the safe default).
func AdminSet(exts []string) map[string]bool {
	set := make(map[string]bool, len(exts))
	for _, e := range exts {
		if e != "" {
			set[e] = true
		}
	}
	return set
}

// RequireAdmin allows the request only when the caller's JWT extension is in the
// admin allow-list; otherwise it writes 403 and aborts. MUST be chained after
// AuthMiddleware, which sets "extension" on the context.
func RequireAdmin(admins map[string]bool) gin.HandlerFunc {
	return func(c *gin.Context) {
		if admins[c.GetString("extension")] {
			c.Next()
			return
		}
		response.Error(c, http.StatusForbidden, "Admin access required")
		c.Abort()
	}
}

// AdminFlag stamps an "is_admin" boolean on the context for every request,
// derived from the JWT extension against the admin allow-list. Unlike
// RequireAdmin it never blocks — it lets role-adaptive handlers (admin sees the
// global view, a user sees only their own) branch via IsAdmin without each
// handler needing the admins map. MUST be chained after AuthMiddleware.
func AdminFlag(admins map[string]bool) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Set("is_admin", admins[c.GetString("extension")])
		c.Next()
	}
}

// IsAdmin reports whether the current request is from an admin, reading the flag
// set by AdminFlag. Safe to call on any protected route.
func IsAdmin(c *gin.Context) bool {
	return c.GetBool("is_admin")
}

// RequireSelfOrAdmin allows the request when the ":ext" path param matches the
// caller's own JWT extension, or the caller is an admin. This closes cross-user
// IDOR on extension-scoped endpoints (a user may only touch their own data;
// admins may touch anyone's). MUST be chained after AuthMiddleware.
func RequireSelfOrAdmin(admins map[string]bool) gin.HandlerFunc {
	return func(c *gin.Context) {
		ext := c.GetString("extension")
		if ext != "" && (admins[ext] || c.Param("ext") == ext) {
			c.Next()
			return
		}
		response.Error(c, http.StatusForbidden, "Access denied")
		c.Abort()
	}
}
