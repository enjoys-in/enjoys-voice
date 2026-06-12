package router

import (
	"github.com/enjoys-in/enjoys-voice/api/internal/handler"
	"github.com/enjoys-in/enjoys-voice/api/internal/middleware"
	"github.com/enjoys-in/enjoys-voice/api/internal/response"
	"github.com/gin-gonic/gin"
)

type Handlers struct {
	Auth       *handler.AuthHandler
	User       *handler.UserHandler
	Settings   *handler.SettingsHandler
	Call       *handler.CallHandler
	Block      *handler.BlockHandler
	Forwarding *handler.ForwardingHandler
	Sound      *handler.SoundHandler
	Ivr        *handler.IvrHandler
	Audit      *handler.AuditHandler
	Voicemail  *handler.VoicemailHandler
}

func Setup(r *gin.Engine, h *Handlers, jwtSecret string) {
	r.Use(middleware.CORS())

	api := r.Group("/api")
	{
		// Health (no auth)
		api.GET("/health", func(c *gin.Context) {
			response.OK(c, gin.H{"status": "ok", "service": "enjoys-voice-api"})
		})

		// Auth (no auth required)
		api.POST("/auth", h.Auth.Login)
		api.POST("/auth/login", h.Auth.Login)
		api.POST("/auth/signup", h.Auth.Signup)

		// ── Data routes ported from the Node HTTP API ───────────────
		// These mirror the (currently public) Express routes so the web
		// app can talk to Go directly. Move them under `protected` once a
		// real token-issuing auth flow exists.
		api.GET("/lookup/:phone", h.User.Lookup)

		// IVR flow builder persistence
		api.GET("/ivr/flows", h.Ivr.List)
		api.POST("/ivr/flows", h.Ivr.Save)
		api.GET("/ivr/flows/:id", h.Ivr.Get)
		api.PUT("/ivr/flows/:id", h.Ivr.Save)
		api.DELETE("/ivr/flows/:id", h.Ivr.Delete)

		// PSTN call forwarding
		api.GET("/pstn-forward/:ext", h.Settings.GetPstnForward)
		api.POST("/pstn-forward/:ext", h.Settings.SetPstnForward)

		// Audit log
		api.GET("/audit", h.Audit.Query)
		api.GET("/audit/:ext", h.Audit.GetByExtension)

		// Voicemails
		api.GET("/voicemails/:ext", h.Voicemail.List)
		api.GET("/voicemails/:ext/:id/audio", h.Voicemail.Audio)
		api.POST("/voicemails/:ext/:id/read", h.Voicemail.MarkRead)
		api.DELETE("/voicemails/:ext/:id", h.Voicemail.Delete)

		// Protected routes
		protected := api.Group("")
		protected.Use(middleware.AuthMiddleware(jwtSecret))
		{
			// Users
			protected.GET("/users", h.User.GetAll)
			protected.GET("/users/:ext", h.User.GetByExtension)
			protected.DELETE("/users/:ext", h.User.Delete)

			// Settings
			protected.GET("/settings/:ext", h.Settings.Get)
			protected.PUT("/settings/:ext", h.Settings.Update)

			// Calls
			protected.GET("/calls", h.Call.GetAll)
			protected.GET("/calls/:ext", h.Call.GetByExtension)

			// Block list
			protected.GET("/block/:ext", h.Block.Get)
			protected.POST("/block/:ext", h.Block.Add)
			protected.DELETE("/block/:ext/:number", h.Block.Remove)

			// Forwarding
			protected.GET("/forwarding/:ext", h.Forwarding.Get)
			protected.POST("/forwarding/:ext", h.Forwarding.Set)

			// Sounds (upload)
			protected.POST("/sounds/upload", h.Sound.Upload)
			protected.GET("/sounds/:ext", h.Sound.GetByExtension)
		}
	}

	// Serve uploaded sounds as static files with aggressive caching
	// Filenames include timestamps so they're effectively immutable
	r.Use(func(c *gin.Context) {
		if len(c.Request.URL.Path) > 8 && c.Request.URL.Path[:8] == "/sounds/" {
			c.Header("Cache-Control", "public, max-age=31536000, immutable")
		}
		c.Next()
	})
	r.Static("/sounds", "./uploads/sounds")
}
