package main

import (
	"log"
	"os"

	"github.com/enjoys-in/enjoys-voice/api/internal/cache"
	"github.com/enjoys-in/enjoys-voice/api/internal/config"
	"github.com/enjoys-in/enjoys-voice/api/internal/handler"
	"github.com/enjoys-in/enjoys-voice/api/internal/models"
	"github.com/enjoys-in/enjoys-voice/api/internal/repository"
	"github.com/enjoys-in/enjoys-voice/api/internal/router"
	"github.com/enjoys-in/enjoys-voice/api/internal/service"
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
	); err != nil {
		log.Fatalf("Failed to migrate: %v", err)
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

	// ─── Services ────────────────────────────────────────
	authSvc := service.NewAuthService(userRepo, settingsRepo, valkey)
	userSvc := service.NewUserService(userRepo, settingsRepo, blockRepo, fwdRepo, soundRepo, valkey)
	settingsSvc := service.NewSettingsService(settingsRepo, userRepo, valkey)
	callSvc := service.NewCallService(callRepo)
	blockSvc := service.NewBlockService(blockRepo, userRepo, valkey)
	fwdSvc := service.NewForwardingService(fwdRepo, userRepo, valkey)
	soundSvc := service.NewSoundService(soundRepo, userRepo, valkey)

	// ─── Handlers ────────────────────────────────────────
	handlers := &router.Handlers{
		Auth:       handler.NewAuthHandler(authSvc),
		User:       handler.NewUserHandler(userSvc),
		Settings:   handler.NewSettingsHandler(settingsSvc),
		Call:       handler.NewCallHandler(callSvc),
		Block:      handler.NewBlockHandler(blockSvc),
		Forwarding: handler.NewForwardingHandler(fwdSvc),
		Sound:      handler.NewSoundHandler(soundSvc, cfg.UploadDir),
	}

	// ─── Ensure upload dir ───────────────────────────────
	if err := os.MkdirAll(cfg.UploadDir, 0755); err != nil {
		log.Fatalf("Failed to create upload dir: %v", err)
	}

	// ─── Router ──────────────────────────────────────────
	r := gin.Default()
	router.Setup(r, handlers, cfg.JWTSecret)

	// ─── Start ───────────────────────────────────────────
	log.Printf("Enjoys Voice API starting on :%s", cfg.Port)
	if err := r.Run(":" + cfg.Port); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
