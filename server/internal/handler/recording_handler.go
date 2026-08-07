package handler

import (
	"errors"
	"os"
	"path/filepath"

	"github.com/enjoys-in/enjoys-voice/api/internal/middleware"
	"github.com/enjoys-in/enjoys-voice/api/internal/response"
	"github.com/enjoys-in/enjoys-voice/api/internal/service"
	"github.com/gin-gonic/gin"
)

// RecordingHandler serves call-recording playback. Strictly owner-scoped: a user
// only ever lists/streams/deletes recordings of calls they were a party to (the
// owning extension is taken from the JWT, never the request); admins may act on
// any single recording by id.
type RecordingHandler struct {
	svc          service.RecordingService
	recordingDir string
}

func NewRecordingHandler(svc service.RecordingService, recordingDir string) *RecordingHandler {
	return &RecordingHandler{svc: svc, recordingDir: recordingDir}
}

// List → GET /recordings : the caller's own recordings.
func (h *RecordingHandler) List(c *gin.Context) {
	recs, err := h.svc.ListByOwner(c.Request.Context(), c.GetString("extension"))
	if err != nil {
		response.Internal(c, err.Error())
		return
	}
	response.OK(c, recs)
}

// Audio → GET /recordings/:id/audio : streams the recording WAV.
func (h *RecordingHandler) Audio(c *gin.Context) {
	id, ok := parseID(c.Param("id"))
	if !ok {
		response.BadRequest(c, "Invalid recording id")
		return
	}
	rec, err := h.svc.Get(c.Request.Context(), id)
	if err != nil {
		h.writeErr(c, err)
		return
	}
	if !h.canAccess(c, rec.Extension) {
		response.NotFound(c, "recording not found")
		return
	}
	path := rec.Path
	if path == "" || !fileExists(path) {
		path = filepath.Join(h.recordingDir, rec.Filename)
	}
	if !fileExists(path) {
		response.NotFound(c, "recording audio file not found")
		return
	}
	c.Header("Content-Type", "audio/wav")
	c.File(path)
}

// Delete → DELETE /recordings/:id : removes the row and its file.
func (h *RecordingHandler) Delete(c *gin.Context) {
	id, ok := parseID(c.Param("id"))
	if !ok {
		response.BadRequest(c, "Invalid recording id")
		return
	}
	rec, err := h.svc.Get(c.Request.Context(), id)
	if err != nil {
		h.writeErr(c, err)
		return
	}
	if !h.canAccess(c, rec.Extension) {
		response.NotFound(c, "recording not found")
		return
	}
	if err := h.svc.Delete(c.Request.Context(), id); err != nil {
		h.writeErr(c, err)
		return
	}
	// Best-effort file cleanup (the DB row is already gone).
	path := rec.Path
	if path == "" {
		path = filepath.Join(h.recordingDir, rec.Filename)
	}
	_ = os.Remove(path)
	response.Success(c, "Recording deleted", nil)
}

func (h *RecordingHandler) canAccess(c *gin.Context, owner string) bool {
	return middleware.IsAdmin(c) || owner == c.GetString("extension")
}

func (h *RecordingHandler) writeErr(c *gin.Context, err error) {
	if errors.Is(err, service.ErrRecordingNotFound) {
		response.NotFound(c, err.Error())
		return
	}
	response.Internal(c, err.Error())
}
