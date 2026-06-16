package handler

import (
	"fmt"
	"path/filepath"
	"time"

	"github.com/enjoys-in/enjoys-voice/api/internal/response"
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
	// Ownership: a sound is always stored for the authenticated caller. Derive
	// the extension from the verified JWT claim (set by the auth middleware),
	// never from client form input, so a user cannot upload to or overwrite
	// another extension's sounds (IDOR).
	ext := c.GetString("extension")
	if ext == "" {
		response.Unauthorized(c, "missing extension claim")
		return
	}
	soundType := c.PostForm("type") // caller_tune | ringtone | ivr
	if soundType != "caller_tune" && soundType != "ringtone" && soundType != "ivr" {
		response.BadRequest(c, "type must be 'caller_tune', 'ringtone', or 'ivr'")
		return
	}

	file, err := c.FormFile("file")
	if err != nil {
		response.BadRequest(c, "No file uploaded")
		return
	}

	// Validate file type
	ct := file.Header.Get("Content-Type")
	if ct != "audio/mpeg" && ct != "audio/wav" && ct != "audio/ogg" && ct != "audio/webm" && ct != "audio/mp4" {
		response.BadRequest(c, "Invalid file type. Accepted: mp3, wav, ogg, webm, mp4")
		return
	}

	// Max 250KB
	if file.Size > 250*1024 {
		response.BadRequest(c, "File too large (max 250KB)")
		return
	}

	// Generate unique filename
	fileExt := filepath.Ext(file.Filename)
	filename := fmt.Sprintf("%s_%s_%d%s", ext, soundType, time.Now().UnixMilli(), fileExt)
	savePath := filepath.Join(h.uploadDir, filename)

	if err := c.SaveUploadedFile(file, savePath); err != nil {
		response.Internal(c, "Failed to save file")
		return
	}

	sound, err := h.soundSvc.Upload(c.Request.Context(), ext, soundType, filename, file.Filename, savePath)
	if err != nil {
		response.Internal(c, "Failed to store sound record")
		return
	}

	response.Created(c, "Sound uploaded", gin.H{
		"filename": sound.Filename,
		"id":       sound.ID,
	})
}

func (h *SoundHandler) GetByExtension(c *gin.Context) {
	ext := c.Param("ext")
	sounds, err := h.soundSvc.GetByExtension(c.Request.Context(), ext)
	if err != nil {
		response.Internal(c, "Failed to fetch sounds")
		return
	}
	response.OK(c, sounds)
}
