package main

import (
	"log"
	"os"

	"github.com/enjoys-in/enjoys-voice/api/internal/audio"
	"github.com/enjoys-in/enjoys-voice/api/internal/cache"
	"github.com/enjoys-in/enjoys-voice/api/internal/config"
	"github.com/enjoys-in/enjoys-voice/api/internal/database"
	"github.com/enjoys-in/enjoys-voice/api/internal/handler"
	"github.com/enjoys-in/enjoys-voice/api/internal/middleware"
	"github.com/enjoys-in/enjoys-voice/api/internal/models"
	"github.com/enjoys-in/enjoys-voice/api/internal/repository"
	"github.com/enjoys-in/enjoys-voice/api/internal/router"
	"github.com/enjoys-in/enjoys-voice/api/internal/service"
	"github.com/enjoys-in/enjoys-voice/api/internal/token"
	"github.com/enjoys-in/enjoys-voice/api/internal/twilio"
	"github.com/gin-gonic/gin"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func main() {
	cfg := config.Load()

	// ─── Database ────────────────────────────────────────
	db, err := gorm.Open(postgres.Open(cfg.DatabaseURL), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Info),
	})
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}

	// Auto-migrate
	if err := db.AutoMigrate(
		&models.User{},
		&models.UserSettings{},
		&models.CallRecord{},
		&models.BlockedNumber{},
		&models.ForwardingRule{},
		&models.Sound{},
		&models.Recording{},
		&models.Voicemail{},
		&models.IvrFlow{},
		&models.AuditLog{},
		&models.SystemSettings{},
		&models.RatePlan{},
		&models.Rate{},
		&models.UserRateOverride{},
		&models.UserBalance{},
		&models.BalanceTxn{},
		&models.Trunk{},
		&models.APIKey{},
		&models.Connector{},
		&models.Contact{},
		&models.RoutingRule{},
		&models.Webhook{},
		&models.AiAgent{},
	); err != nil {
		log.Fatalf("Failed to migrate: %v", err)
	}

	// Apply SQL migrations (seed data) — idempotent, safe on every startup.
	if err := database.RunSQLMigrations(db, cfg.MigrationsDir); err != nil {
		log.Fatalf("Failed to run SQL migrations: %v", err)
	}

	// ─── Cache (Valkey) ──────────────────────────────────
	valkey, err := cache.NewValkeyCache(cfg.ValkeyAddr, cfg.ValkeyPass, cfg.ValkeyDB)
	if err != nil {
		log.Fatalf("Failed to connect to Valkey: %v", err)
	}
	log.Println("Connected to Valkey at", cfg.ValkeyAddr)

	// ─── Repositories ────────────────────────────────────
	userRepo := repository.NewUserRepository(db)
	settingsRepo := repository.NewSettingsRepository(db)
	callRepo := repository.NewCallRepository(db)
	blockRepo := repository.NewBlockRepository(db)
	fwdRepo := repository.NewForwardingRepository(db)
	soundRepo := repository.NewSoundRepository(db)
	ivrRepo := repository.NewIvrFlowRepository(db)
	auditRepo := repository.NewAuditRepository(db)
	vmRepo := repository.NewVoicemailRepository(db)
	systemSettingsRepo := repository.NewSystemSettingsRepository(db)
	rateRepo := repository.NewRateRepository(db)
	balanceRepo := repository.NewBalanceRepository(db)
	trunkRepo := repository.NewTrunkRepository(db)
	apiKeyRepo := repository.NewAPIKeyRepository(db)
	connectorRepo := repository.NewConnectorRepository(db)
	scheduleRepo := repository.NewScheduleRepository(db)
	contactRepo := repository.NewContactRepository(db)
	routingRuleRepo := repository.NewRoutingRuleRepository(db)
	webhookRepo := repository.NewWebhookRepository(db)
	aiAgentRepo := repository.NewAiAgentRepository(db)

	// ─── Services ────────────────────────────────────────
	authSvc := service.NewAuthService(userRepo, settingsRepo, valkey)
	userSvc := service.NewUserService(userRepo, settingsRepo, blockRepo, fwdRepo, soundRepo, valkey)
	settingsSvc := service.NewSettingsService(settingsRepo, userRepo, valkey)
	callSvc := service.NewCallService(callRepo)
	blockSvc := service.NewBlockService(blockRepo, userRepo, valkey)
	fwdSvc := service.NewForwardingService(fwdRepo, userRepo, valkey)
	soundSvc := service.NewSoundService(soundRepo, userRepo, valkey)
	ivrSvc := service.NewIvrService(ivrRepo, valkey)
	auditSvc := service.NewAuditService(auditRepo)
	vmSvc := service.NewVoicemailService(vmRepo)
	systemSettingsSvc := service.NewSystemSettingsService(systemSettingsRepo)
	rateSvc := service.NewRateService(rateRepo)
	balanceSvc := service.NewBalanceService(balanceRepo, cfg.Billing.Currency, cfg.Billing.PrepaidEnabled)
	trunkSvc := service.NewTrunkService(trunkRepo)
	apiKeySvc := service.NewAPIKeyService(apiKeyRepo)
	connectorSvc := service.NewConnectorService(connectorRepo)
	scheduleSvc := service.NewScheduleService(scheduleRepo)
	contactSvc := service.NewContactService(contactRepo)
	routingRuleSvc := service.NewRoutingRuleService(routingRuleRepo)
	webhookSvc := service.NewWebhookService(webhookRepo)
	aiAgentSvc := service.NewAiAgentService(aiAgentRepo)
	// Twilio client powers provider-native (BYON) caller-ID verification and OTP
	// SMS delivery. With no credentials configured it stays disabled and the
	// dependent endpoints return 503.
	twilioClient := twilio.NewClient(cfg.Twilio.AccountSID, cfg.Twilio.AuthToken, cfg.Twilio.SMSFrom)
	callerIDSvc := service.NewCallerIDService(settingsRepo, userRepo, twilioClient, valkey, cfg.CallerIDVerifyTTL)
	// OTP service: SMS one-time passwords for mobile-verified signup and
	// passwordless login. Reuses authSvc so signup-via-OTP shares account creation.
	otpSvc := service.NewOTPService(authSvc, userRepo, twilioClient, valkey, cfg.OTPDevEcho)

	// ─── Tokens ──────────────────────────────────────────
	tokenMgr := token.NewManager(cfg.JWTSecret, cfg.JWTIssuer, cfg.AccessTTL, cfg.RefreshTTL)

	// ─── Audio ───────────────────────────────────────────
	// ffmpeg-backed transcoder for normalizing IVR sound uploads to the
	// FreeSWITCH-canonical WAV. Disabled gracefully when no ffmpeg is present.
	transcoder := audio.NewTranscoder(cfg.FFmpegPath)

	// ─── Handlers ────────────────────────────────────────
	handlers := &router.Handlers{
		Auth:           handler.NewAuthHandler(authSvc, otpSvc, tokenMgr, cfg.Sip, cfg.Cookie),
		User:           handler.NewUserHandler(userSvc),
		Settings:       handler.NewSettingsHandler(settingsSvc),
		Call:           handler.NewCallHandler(callSvc),
		Block:          handler.NewBlockHandler(blockSvc),
		Forwarding:     handler.NewForwardingHandler(fwdSvc),
		Sound:          handler.NewSoundHandler(soundSvc, cfg.UploadDir, cfg.IvrDir, transcoder),
		Ivr:            handler.NewIvrHandler(ivrSvc),
		Audit:          handler.NewAuditHandler(auditSvc),
		Voicemail:      handler.NewVoicemailHandler(vmSvc, cfg.VoicemailDir),
		SystemSettings: handler.NewSystemSettingsHandler(systemSettingsSvc),
		Rate:           handler.NewRateHandler(rateSvc),
		CallerID:       handler.NewCallerIDHandler(callerIDSvc),
		Balance:        handler.NewBalanceHandler(balanceSvc, cfg.AdminExtensions),
		Trunk:          handler.NewTrunkHandler(trunkSvc, cfg.AdminExtensions),
		APIKey:         handler.NewAPIKeyHandler(apiKeySvc),
		Connector:      handler.NewConnectorHandler(connectorSvc),
		Schedule:       handler.NewScheduleHandler(scheduleSvc, cfg.AdminExtensions),
		Contact:        handler.NewContactHandler(contactSvc),
		RoutingRule:    handler.NewRoutingRuleHandler(routingRuleSvc),
		Webhook:        handler.NewWebhookHandler(webhookSvc),
		AiAgent:        handler.NewAiAgentHandler(aiAgentSvc),
	}

	// ─── Ensure upload dir ───────────────────────────────
	if err := os.MkdirAll(cfg.UploadDir, 0755); err != nil {
		log.Fatalf("Failed to create upload dir: %v", err)
	}
	// IVR prompts are normalized here onto a FreeSWITCH-readable path.
	if err := os.MkdirAll(cfg.IvrDir, 0755); err != nil {
		log.Fatalf("Failed to create IVR sound dir: %v", err)
	}

	// ─── Router ──────────────────────────────────────────
	r := gin.Default()
	router.Setup(r, handlers, tokenMgr, middleware.AdminSet(cfg.AdminExtensions))

	// ─── Start ───────────────────────────────────────────
	log.Printf("Enjoys Voice API starting on :%s", cfg.Port)
	if err := r.Run(":" + cfg.Port); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
