package router

import (
	"github.com/enjoys-in/enjoys-voice/api/internal/handler"
	"github.com/enjoys-in/enjoys-voice/api/internal/middleware"
	"github.com/enjoys-in/enjoys-voice/api/internal/response"
	"github.com/enjoys-in/enjoys-voice/api/internal/token"
	"github.com/gin-gonic/gin"
)

type Handlers struct {
	Auth           *handler.AuthHandler
	User           *handler.UserHandler
	Settings       *handler.SettingsHandler
	SystemSettings *handler.SystemSettingsHandler
	Call           *handler.CallHandler
	Block          *handler.BlockHandler
	Forwarding     *handler.ForwardingHandler
	Sound          *handler.SoundHandler
	Ivr            *handler.IvrHandler
	Audit          *handler.AuditHandler
	Voicemail      *handler.VoicemailHandler
	Rate           *handler.RateHandler
	CallerID       *handler.CallerIDHandler
	Balance        *handler.BalanceHandler
	Trunk          *handler.TrunkHandler
	APIKey         *handler.APIKeyHandler
	Connector      *handler.ConnectorHandler
	Schedule       *handler.ScheduleHandler
}

func Setup(r *gin.Engine, h *Handlers, tm *token.Manager) {
	r.Use(middleware.CORS())

	// Reply with the standard { success, message, data } envelope for unknown
	// routes / methods instead of gin's plain-text "404 page not found".
	// HandleMethodNotAllowed makes a wrong method on a known path surface as 405
	// (NoMethod) rather than a generic 404.
	r.HandleMethodNotAllowed = true
	r.NoRoute(func(c *gin.Context) {
		response.NotFound(c, "Route not found: "+c.Request.Method+" "+c.Request.URL.Path)
	})
	r.NoMethod(func(c *gin.Context) {
		response.MethodNotAllowed(c, "Method not allowed: "+c.Request.Method+" "+c.Request.URL.Path)
	})

	// Go API is mounted under /api/g so a single domain can route both backends
	// via Caddy ( /api/g/* -> Go, /api/n/* -> Node ). In dev the port (3003) also
	// separates it, so the prefix is consistent in both environments.
	api := r.Group("/api/g")
	{
		// Health (no auth)
		api.GET("/health", func(c *gin.Context) {
			response.OK(c, gin.H{"status": "ok", "service": "enjoys-voice-api"})
		})

		// Auth (no auth required)
		api.POST("/auth", h.Auth.Login)
		api.POST("/auth/login", h.Auth.Login)
		api.POST("/auth/signup", h.Auth.Signup)
		api.POST("/auth/refresh", h.Auth.Refresh)
		// Passwordless / verified flows: request a code, then verify it to sign up
		// (mobile-verified) or log in (mobile + OTP, no password).
		api.POST("/auth/otp/request", h.Auth.RequestOTP)
		api.POST("/auth/signup/verify", h.Auth.SignupVerify)
		api.POST("/auth/login/otp", h.Auth.LoginOTP)
		// Logout clears the httpOnly auth cookies. Public on purpose: an expired
		// session must still be able to tear its cookies down.
		api.POST("/auth/logout", h.Auth.Logout)

		// Public branding/customization read so the login screen can theme itself
		// before a session exists. Writes are admin-gated under the protected group.
		api.GET("/system-settings", h.SystemSettings.Get)

		// Protected routes
		protected := api.Group("")
		protected.Use(middleware.AuthMiddleware(tm))
		{
			// Current-session profile / validator (UI calls this on boot).
			protected.GET("/auth/me", h.Auth.Me)
			protected.PATCH("/auth/me", h.Auth.UpdateMe)

			protected.GET("/lookup/:phone", h.User.Lookup)

			// IVR flow builder persistence
			protected.GET("/ivr/flows", h.Ivr.List)
			protected.POST("/ivr/flows", h.Ivr.Save)
			protected.GET("/ivr/flows/:id", h.Ivr.Get)
			protected.PUT("/ivr/flows/:id", h.Ivr.Save)
			protected.DELETE("/ivr/flows/:id", h.Ivr.Delete)

			// Outbound integration connectors (email / webhook) the IVR builder
			// can trigger. Secrets are redacted on read.
			protected.GET("/connectors", h.Connector.List)
			protected.POST("/connectors", h.Connector.Create)
			protected.GET("/connectors/:id", h.Connector.Get)
			protected.PUT("/connectors/:id", h.Connector.Update)
			protected.DELETE("/connectors/:id", h.Connector.Delete)

			// PSTN call forwarding
			protected.GET("/pstn-forward/:ext", h.Settings.GetPstnForward)
			protected.POST("/pstn-forward/:ext", h.Settings.SetPstnForward)

			// Audit log
			protected.GET("/audit", h.Audit.Query)
			protected.GET("/audit/:ext", h.Audit.GetByExtension)

			// Voicemails
			protected.GET("/voicemails/:ext", h.Voicemail.List)
			protected.GET("/voicemails/:ext/:id/audio", h.Voicemail.Audio)
			protected.POST("/voicemails/:ext/:id/read", h.Voicemail.MarkRead)
			protected.DELETE("/voicemails/:ext/:id", h.Voicemail.Delete)

			// Users
			protected.GET("/users", h.User.GetAll)
			protected.GET("/users/:ext", h.User.GetByExtension)
			protected.DELETE("/users/:ext", h.User.Delete)

			// Settings
			protected.GET("/settings/:ext", h.Settings.Get)
			protected.PUT("/settings/:ext", h.Settings.Update)

			// Outbound caller ID (BYON). Extension is taken from the JWT inside
			// the handler, so these are unparameterised — a user only ever manages
			// their own caller ID.
			protected.GET("/caller-id", h.CallerID.Get)
			protected.POST("/caller-id/verify/start", h.CallerID.Start)
			protected.POST("/caller-id/verify/confirm", h.CallerID.Confirm)
			protected.DELETE("/caller-id", h.CallerID.Delete)

			// System-wide customization (branding + default policies)
			protected.PUT("/system-settings", h.SystemSettings.Update)

			// Call rate plans + per-destination rates (billing). Plans hold a
			// currency + a set of longest-prefix-matched rates; rates are nested
			// under their plan.
			protected.GET("/rate-plans", h.Rate.ListPlans)
			protected.POST("/rate-plans", h.Rate.CreatePlan)
			protected.GET("/rate-plans/:id", h.Rate.GetPlan)
			protected.PUT("/rate-plans/:id", h.Rate.UpdatePlan)
			protected.DELETE("/rate-plans/:id", h.Rate.DeletePlan)
			protected.GET("/rate-plans/:id/rates", h.Rate.ListRates)
			protected.POST("/rate-plans/:id/rates", h.Rate.CreateRate)
			protected.POST("/rate-plans/:id/rates/import", h.Rate.ImportRates)
			protected.PUT("/rate-plans/:id/rates/:rateId", h.Rate.UpdateRate)
			protected.DELETE("/rate-plans/:id/rates/:rateId", h.Rate.DeleteRate)

			// Prepaid wallet. Self-reads (no :ext) derive the extension from the
			// JWT; the :ext variants and top-up are admin-only (ADMIN_EXTENSIONS).
			protected.GET("/balance", h.Balance.GetSelf)
			protected.GET("/balance/txns", h.Balance.TxnsSelf)
			protected.GET("/balance/:ext", h.Balance.GetByExt)
			protected.GET("/balance/:ext/txns", h.Balance.TxnsByExt)
			protected.POST("/balance/:ext/topup", h.Balance.TopUp)

			// Upstream SIP trunks (PSTN gateways). Admin-only — trunks carry
			// provider credentials and decide how external calls egress. The
			// :id/test route fires a SIP OPTIONS ping for a reachability check.
			protected.GET("/trunks", h.Trunk.List)
			protected.POST("/trunks", h.Trunk.Create)
			protected.GET("/trunks/:id", h.Trunk.Get)
			protected.PUT("/trunks/:id", h.Trunk.Update)
			protected.DELETE("/trunks/:id", h.Trunk.Delete)
			protected.POST("/trunks/:id/test", h.Trunk.Test)

			// Developer API keys for the embeddable click-to-call widget. Owner-
			// scoped (the owning extension comes from the JWT inside the handler),
			// so a user only ever manages their own keys.
			protected.GET("/api-keys", h.APIKey.List)
			protected.POST("/api-keys", h.APIKey.Create)
			protected.PUT("/api-keys/:id", h.APIKey.Update)
			protected.DELETE("/api-keys/:id", h.APIKey.Delete)

			// Calls
			protected.GET("/calls", h.Call.GetAll)
			protected.GET("/calls/:ext", h.Call.GetByExtension)
			protected.DELETE("/calls/:ext", h.Call.DeleteByExtension)

			// Dashboard stats (aggregate call metrics)
			protected.GET("/stats", h.Call.Stats)

			// Block list
			protected.GET("/block/:ext", h.Block.Get)
			protected.POST("/block/:ext", h.Block.Add)
			protected.DELETE("/block/:ext/:number", h.Block.Remove)

			// Forwarding
			protected.GET("/forwarding/:ext", h.Forwarding.Get)
			protected.POST("/forwarding/:ext", h.Forwarding.Set)

			// Routing schedules: global business hours (admin-only write) and
			// per-user availability windows. Empty/disabled config = always open.
			protected.GET("/business-hours", h.Schedule.GetBusinessHours)
			protected.PUT("/business-hours", h.Schedule.SaveBusinessHours)
			protected.GET("/availability/:ext", h.Schedule.ListAvailability)
			protected.PUT("/availability/:ext", h.Schedule.SaveAvailability)

			// Sounds (upload)
			protected.POST("/sounds/upload", h.Sound.Upload)
			protected.GET("/sounds/:ext", h.Sound.GetByExtension)
			protected.DELETE("/sounds/:id", h.Sound.Delete)
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
