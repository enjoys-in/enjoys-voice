package router

import (
	"github.com/enjoys-in/enjoys-voice/api/internal/handler"
	"github.com/enjoys-in/enjoys-voice/api/internal/middleware"
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
}

func Setup(r *gin.Engine, h *Handlers, jwtSecret string) {
	r.Use(middleware.CORS())

	api := r.Group("/api")
	{
		// Health (no auth)
		api.GET("/health", func(c *gin.Context) {
			c.JSON(200, gin.H{"status": "ok", "service": "enjoys-voice-api"})
		})

		// Auth (no auth required)
		api.POST("/auth", h.Auth.Login)
		api.POST("/auth/login", h.Auth.Login)
		api.POST("/auth/signup", h.Auth.Signup)

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
