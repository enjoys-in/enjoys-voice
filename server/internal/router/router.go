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

func Setup(r *gin.Engine, h *Handlers, tm *token.Manager, admins map[string]bool) {
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
			// Per-route authorization guards (run after AuthMiddleware):
			//   admin       — caller must be in ADMIN_EXTENSIONS
			//   selfOrAdmin — :ext must be the caller's own extension, or admin
			admin := middleware.RequireAdmin(admins)
			selfOrAdmin := middleware.RequireSelfOrAdmin(admins)

			// Stamp is_admin on every protected request so role-adaptive
			// handlers (admin = global view, user = own data) can branch via
			// middleware.IsAdmin without each one needing the admins map.
			protected.Use(middleware.AdminFlag(admins))

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
			protected.GET("/pstn-forward/:ext", selfOrAdmin, h.Settings.GetPstnForward)
			protected.POST("/pstn-forward/:ext", selfOrAdmin, h.Settings.SetPstnForward)

			// Audit log (admin-only — spans every user).
			protected.GET("/audit", admin, h.Audit.Query)
			protected.GET("/audit/:ext", selfOrAdmin, h.Audit.GetByExtension)

			// Voicemails (a user only ever sees their own mailbox).
			protected.GET("/voicemails/:ext", selfOrAdmin, h.Voicemail.List)
			protected.GET("/voicemails/:ext/:id/audio", selfOrAdmin, h.Voicemail.Audio)
			protected.POST("/voicemails/:ext/:id/read", selfOrAdmin, h.Voicemail.MarkRead)
			protected.DELETE("/voicemails/:ext/:id", selfOrAdmin, h.Voicemail.Delete)

			// Users — listing every user + deleting are admin-only; reading one
			// extension is limited to the owner (or an admin).
			protected.GET("/users", admin, h.User.GetAll)
			protected.GET("/users/:ext", selfOrAdmin, h.User.GetByExtension)
			protected.DELETE("/users/:ext", admin, h.User.Delete)

			// Settings (own only, or admin).
			protected.GET("/settings/:ext", selfOrAdmin, h.Settings.Get)
			protected.PUT("/settings/:ext", selfOrAdmin, h.Settings.Update)

			// Outbound caller ID (BYON). Extension is taken from the JWT inside
			// the handler, so these are unparameterised — a user only ever manages
			// their own caller ID.
			protected.GET("/caller-id", h.CallerID.Get)
			protected.POST("/caller-id/verify/start", h.CallerID.Start)
			protected.POST("/caller-id/verify/confirm", h.CallerID.Confirm)
			protected.DELETE("/caller-id", h.CallerID.Delete)

			// System-wide customization (branding + default policies). Read is
			// public (above, for the login screen); writing is admin-only.
			protected.PUT("/system-settings", admin, h.SystemSettings.Update)

			// Call rate plans + per-destination rates (billing). Pricing config is
			// admin-only; a user reads their own effective plan elsewhere.
			protected.GET("/rate-plans", admin, h.Rate.ListPlans)
			protected.POST("/rate-plans", admin, h.Rate.CreatePlan)
			protected.GET("/rate-plans/:id", admin, h.Rate.GetPlan)
			protected.PUT("/rate-plans/:id", admin, h.Rate.UpdatePlan)
			protected.DELETE("/rate-plans/:id", admin, h.Rate.DeletePlan)
			protected.GET("/rate-plans/:id/rates", admin, h.Rate.ListRates)
			protected.POST("/rate-plans/:id/rates", admin, h.Rate.CreateRate)
			protected.POST("/rate-plans/:id/rates/import", admin, h.Rate.ImportRates)
			protected.PUT("/rate-plans/:id/rates/:rateId", admin, h.Rate.UpdateRate)
			protected.DELETE("/rate-plans/:id/rates/:rateId", admin, h.Rate.DeleteRate)

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

			// Calls — role-adaptive: an admin gets the full firehose + global
			// stats, a regular user gets only their own history/metrics (derived
			// from the JWT inside the handler). Reading/clearing a specific
			// extension still requires self (or admin).
			protected.GET("/calls", h.Call.GetAll)
			protected.GET("/calls/:ext", selfOrAdmin, h.Call.GetByExtension)
			protected.DELETE("/calls/:ext", selfOrAdmin, h.Call.DeleteByExtension)

			// Dashboard stats — admin sees aggregate metrics across all users; a
			// user sees stats scoped to their own call history.
			protected.GET("/stats", h.Call.Stats)

			// Block list (own only, or admin)
			protected.GET("/block/:ext", selfOrAdmin, h.Block.Get)
			protected.POST("/block/:ext", selfOrAdmin, h.Block.Add)
			protected.DELETE("/block/:ext/:number", selfOrAdmin, h.Block.Remove)

			// Forwarding (own only, or admin)
			protected.GET("/forwarding/:ext", selfOrAdmin, h.Forwarding.Get)
			protected.POST("/forwarding/:ext", selfOrAdmin, h.Forwarding.Set)

			// Routing schedules: global business hours (admin write) and per-user
			// availability windows. A user reads and writes only their own
			// availability (selfOrAdmin); the global policy read stays open and its
			// write is admin-only.
			protected.GET("/business-hours", h.Schedule.GetBusinessHours)
			protected.PUT("/business-hours", h.Schedule.SaveBusinessHours)
			protected.GET("/availability/:ext", selfOrAdmin, h.Schedule.ListAvailability)
			protected.PUT("/availability/:ext", selfOrAdmin, h.Schedule.SaveAvailability)

			// Routing announcement wording. Read is open (engine/UI resolve
			// effective text); write is admin-only. Empty/missing key = engine
			// default, so an empty table preserves the shipped wording.
			protected.GET("/routing-prompts", h.Schedule.GetPrompts)
			protected.PUT("/routing-prompts", h.Schedule.SavePrompts)

			// Sounds (upload). A user reads only their own uploaded sounds.
			protected.POST("/sounds/upload", h.Sound.Upload)
			protected.GET("/sounds/:ext", selfOrAdmin, h.Sound.GetByExtension)
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
