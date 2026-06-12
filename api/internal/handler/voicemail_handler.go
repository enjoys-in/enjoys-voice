package handler

import (
	"os"
	"path/filepath"
	"strconv"

	"github.com/enjoys-in/enjoys-voice/api/internal/response"
	"github.com/enjoys-in/enjoys-voice/api/internal/service"
	"github.com/gin-gonic/gin"
)

type VoicemailHandler struct {
	vmSvc        service.VoicemailService
	voicemailDir string
}

func NewVoicemailHandler(vs service.VoicemailService, voicemailDir string) *VoicemailHandler {
	return &VoicemailHandler{vmSvc: vs, voicemailDir: voicemailDir}
}

func parseID(v string) (uint, bool) {
	n, err := strconv.ParseUint(v, 10, 64)
	if err != nil {
		return 0, false
	}
	return uint(n), true
}

// List → GET /voicemails/:ext
func (h *VoicemailHandler) List(c *gin.Context) {
	ext := c.Param("ext")
	vms, unread, err := h.vmSvc.List(c.Request.Context(), ext)
	if err != nil {
		response.Internal(c, "Failed to fetch voicemails")
		return
	}
	response.OK(c, gin.H{"voicemails": vms, "unread": unread})
}

// Audio → GET /voicemails/:ext/:id/audio : streams the raw WAV (not enveloped).
func (h *VoicemailHandler) Audio(c *gin.Context) {
	ext := c.Param("ext")
	id, ok := parseID(c.Param("id"))
	if !ok {
		response.BadRequest(c, "Invalid voicemail id")
		return
	}

	vm, err := h.vmSvc.Get(c.Request.Context(), ext, id)
	if err != nil {
		response.NotFound(c, "Voicemail not found")
		return
	}

	// Prefer the stored absolute path; fall back to the configured directory.
	path := vm.Path
	if path == "" || !fileExists(path) {
		path = filepath.Join(h.voicemailDir, vm.Filename)
	}
	if !fileExists(path) {
		response.NotFound(c, "Voicemail audio file not found")
		return
	}

	c.Header("Content-Type", "audio/wav")
	c.File(path)
}

// MarkRead → POST /voicemails/:ext/:id/read
func (h *VoicemailHandler) MarkRead(c *gin.Context) {
	ext := c.Param("ext")
	id, ok := parseID(c.Param("id"))
	if !ok {
		response.BadRequest(c, "Invalid voicemail id")
		return
	}

	unread, err := h.vmSvc.MarkRead(c.Request.Context(), ext, id)
	if err != nil {
		response.NotFound(c, "Voicemail not found")
		return
	}
	response.Success(c, "Marked as read", gin.H{"unread": unread})
}

// Delete → DELETE /voicemails/:ext/:id
func (h *VoicemailHandler) Delete(c *gin.Context) {
	ext := c.Param("ext")
	id, ok := parseID(c.Param("id"))
	if !ok {
		response.BadRequest(c, "Invalid voicemail id")
		return
	}

	unread, err := h.vmSvc.Delete(c.Request.Context(), ext, id)
	if err != nil {
		response.NotFound(c, "Voicemail not found")
		return
	}
	response.Success(c, "Voicemail deleted", gin.H{"unread": unread})
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}
