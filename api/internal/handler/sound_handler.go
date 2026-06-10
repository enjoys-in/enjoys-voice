package handler

import (
	"fmt"
	"net/http"
	"path/filepath"
	"time"

	"github.com/enjoys-in/enjoys-voice/api/internal/service"
	"github.com/gin-gonic/gin"
)

type SoundHandler struct {
	soundSvc  service.SoundService
	uploadDir string
}

func NewSoundHandler(ss service.SoundService, uploadDir string) *SoundHandler {
	return &SoundHandler{soundSvc: ss, uploadDir: uploadDir}
}

func (h *SoundHandler) Upload(c *gin.Context) {
	ext := c.PostForm("extension")
	if ext == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "extension is required"})
		return
	}
	soundType := c.PostForm("type") // caller_tune or ringtone
	if soundType != "caller_tune" && soundType != "ringtone" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "type must be 'caller_tune' or 'ringtone'"})
		return
	}

	file, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No file uploaded"})
		return
	}

	// Validate file type
	ct := file.Header.Get("Content-Type")
	if ct != "audio/mpeg" && ct != "audio/wav" && ct != "audio/ogg" && ct != "audio/webm" && ct != "audio/mp4" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid file type. Accepted: mp3, wav, ogg, webm, mp4"})
		return
	}

	// Max 250KB
	if file.Size > 250*1024 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "File too large (max 250KB)"})
		return
	}

	// Generate unique filename
	fileExt := filepath.Ext(file.Filename)
	filename := fmt.Sprintf("%s_%s_%d%s", ext, soundType, time.Now().UnixMilli(), fileExt)
	savePath := filepath.Join(h.uploadDir, filename)

	if err := c.SaveUploadedFile(file, savePath); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save file"})
		return
	}

	sound, err := h.soundSvc.Upload(c.Request.Context(), ext, soundType, filename, file.Filename, savePath)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to store sound record"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"success":  true,
		"filename": sound.Filename,
		"id":       sound.ID,
	})
}

func (h *SoundHandler) GetByExtension(c *gin.Context) {
	ext := c.Param("ext")
	sounds, err := h.soundSvc.GetByExtension(c.Request.Context(), ext)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch sounds"})
		return
	}
	c.JSON(http.StatusOK, sounds)
}
