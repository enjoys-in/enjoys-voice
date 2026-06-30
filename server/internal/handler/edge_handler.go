package handler

import (
	"errors"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/enjoys-in/enjoys-voice/api/internal/models"
	"github.com/enjoys-in/enjoys-voice/api/internal/response"
	"github.com/enjoys-in/enjoys-voice/api/internal/service"
	"github.com/gin-gonic/gin"
)

// EdgeHandler serves two surfaces:
//   - admin CRUD to provision edge appliances (JWT + admin, wired in the router),
//   - the device sync surface authenticated by the per-device token (DeviceAuth).
type EdgeHandler struct {
	svc          service.EdgeService
	voicemailDir string
}

func NewEdgeHandler(svc service.EdgeService, voicemailDir string) *EdgeHandler {
	return &EdgeHandler{svc: svc, voicemailDir: voicemailDir}
}

// DeviceAuth authenticates an edge appliance by `Authorization: Bearer <token>`
// + `X-Device-Id`, stamps the device id on the context, and best-effort touches
// last_seen. Use it on the /api/g/edge/* group (these are NOT JWT routes).
func (h *EdgeHandler) DeviceAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		token := ""
		if auth := c.GetHeader("Authorization"); auth != "" {
			if parts := strings.SplitN(auth, " ", 2); len(parts) == 2 && strings.EqualFold(parts[0], "bearer") {
				token = parts[1]
			}
		}
		dev, err := h.svc.Authenticate(c.Request.Context(), c.GetHeader("X-Device-Id"), token)
		if err != nil {
			response.Unauthorized(c, "Edge device authentication failed")
			c.Abort()
			return
		}
		c.Set("edge_device_id", dev.DeviceID)
		h.svc.TouchSeen(c.Request.Context(), dev.DeviceID)
		c.Next()
	}
}

func (h *EdgeHandler) deviceID(c *gin.Context) string { return c.GetString("edge_device_id") }

// ── device sync endpoints ────────────────────────────────────────────────

// Health → GET /api/g/edge/health
func (h *EdgeHandler) Health(c *gin.Context) {
	response.OK(c, gin.H{"status": "ok", "device_id": h.deviceID(c)})
}

// Extensions → GET /api/g/edge/extensions
func (h *EdgeHandler) Extensions(c *gin.Context) {
	exts, err := h.svc.Extensions(c.Request.Context(), h.deviceID(c))
	if err != nil {
		response.Internal(c, err.Error())
		return
	}
	response.OK(c, exts)
}

// Trunk → GET /api/g/edge/trunk
func (h *EdgeHandler) Trunk(c *gin.Context) {
	trunk, err := h.svc.Trunk(c.Request.Context(), h.deviceID(c))
	if err != nil {
		response.Internal(c, err.Error())
		return
	}
	if trunk == nil {
		response.NotFound(c, "No trunk configured for this device")
		return
	}
	response.OK(c, trunk)
}

// IngestCDR → POST /api/g/edge/cdr  {rows:[...]}
func (h *EdgeHandler) IngestCDR(c *gin.Context) {
	var body struct {
		Rows []models.EdgeCDR `json:"rows"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.BadRequest(c, "Invalid request body")
		return
	}
	if err := h.svc.IngestCDRs(c.Request.Context(), h.deviceID(c), body.Rows); err != nil {
		response.Internal(c, err.Error())
		return
	}
	response.OK(c, gin.H{"accepted": len(body.Rows)})
}

// UploadVoicemail → POST /api/g/edge/voicemail  (multipart "file")
func (h *EdgeHandler) UploadVoicemail(c *gin.Context) {
	fileHeader, err := c.FormFile("file")
	if err != nil {
		response.BadRequest(c, "Missing file")
		return
	}
	dir := filepath.Join(h.voicemailDir, "edge", sanitizeSegment(h.deviceID(c)))
	if err := os.MkdirAll(dir, 0o755); err != nil {
		response.Internal(c, "Failed to create voicemail dir")
		return
	}
	dst := filepath.Join(dir, sanitizeSegment(filepath.Base(fileHeader.Filename)))

	src, err := fileHeader.Open()
	if err != nil {
		response.Internal(c, "Failed to read upload")
		return
	}
	defer src.Close()
	out, err := os.Create(dst)
	if err != nil {
		response.Internal(c, "Failed to store voicemail")
		return
	}
	defer out.Close()
	if _, err := io.Copy(out, src); err != nil {
		response.Internal(c, "Failed to write voicemail")
		return
	}
	response.OK(c, gin.H{"stored": filepath.Base(dst)})
}

// ── admin CRUD (provisioning) ────────────────────────────────────────────

func (h *EdgeHandler) ListDevices(c *gin.Context) {
	devices, err := h.svc.ListDevices(c.Request.Context())
	if err != nil {
		response.Internal(c, err.Error())
		return
	}
	response.OK(c, devices)
}

func (h *EdgeHandler) CreateDevice(c *gin.Context) {
	var input service.EdgeDeviceInput
	if err := c.ShouldBindJSON(&input); err != nil {
		response.BadRequest(c, "Invalid request body")
		return
	}
	dev, err := h.svc.CreateDevice(c.Request.Context(), &input)
	if err != nil {
		h.writeErr(c, err)
		return
	}
	response.Created(c, "Edge device created", dev)
}

func (h *EdgeHandler) GetDevice(c *gin.Context) {
	id, ok := h.parseID(c)
	if !ok {
		return
	}
	dev, err := h.svc.GetDevice(c.Request.Context(), id)
	if err != nil {
		h.writeErr(c, err)
		return
	}
	response.OK(c, dev)
}

func (h *EdgeHandler) UpdateDevice(c *gin.Context) {
	id, ok := h.parseID(c)
	if !ok {
		return
	}
	var input service.EdgeDeviceInput
	if err := c.ShouldBindJSON(&input); err != nil {
		response.BadRequest(c, "Invalid request body")
		return
	}
	dev, err := h.svc.UpdateDevice(c.Request.Context(), id, &input)
	if err != nil {
		h.writeErr(c, err)
		return
	}
	response.Success(c, "Edge device updated", dev)
}

func (h *EdgeHandler) DeleteDevice(c *gin.Context) {
	id, ok := h.parseID(c)
	if !ok {
		return
	}
	if err := h.svc.DeleteDevice(c.Request.Context(), id); err != nil {
		h.writeErr(c, err)
		return
	}
	response.Success(c, "Edge device deleted", nil)
}

func (h *EdgeHandler) parseID(c *gin.Context) (uint, bool) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		response.BadRequest(c, "Invalid edge device id")
		return 0, false
	}
	return uint(id), true
}

func (h *EdgeHandler) writeErr(c *gin.Context, err error) {
	switch {
	case errors.Is(err, service.ErrEdgeDeviceNotFound):
		response.NotFound(c, err.Error())
	case errors.Is(err, service.ErrEdgeDeviceInvalid):
		response.BadRequest(c, err.Error())
	default:
		response.Internal(c, err.Error())
	}
}

// sanitizeSegment strips path traversal + separators from a path segment.
func sanitizeSegment(s string) string {
	s = strings.ReplaceAll(s, "..", "")
	s = strings.ReplaceAll(s, "/", "_")
	s = strings.ReplaceAll(s, "\\", "_")
	if s = strings.TrimSpace(s); s == "" {
		return "unknown"
	}
	return s
}
