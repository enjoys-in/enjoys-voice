package handler

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/enjoys-in/enjoys-voice/api/internal/response"
	"github.com/enjoys-in/enjoys-voice/api/internal/service"
	"github.com/gin-gonic/gin"
)

// TrunkHandler manages upstream SIP trunk definitions. Trunks carry provider
// credentials and decide how external calls leave the platform, so every
// endpoint is admin-only (ADMIN_EXTENSIONS allow-list). With an empty list all
// trunk management is denied — the safe default.
type TrunkHandler struct {
	svc    service.TrunkService
	admins map[string]bool
}

func NewTrunkHandler(svc service.TrunkService, adminExtensions []string) *TrunkHandler {
	admins := make(map[string]bool, len(adminExtensions))
	for _, ext := range adminExtensions {
		if ext != "" {
			admins[ext] = true
		}
	}
	return &TrunkHandler{svc: svc, admins: admins}
}

// List → GET /trunks
func (h *TrunkHandler) List(c *gin.Context) {
	if !h.requireAdmin(c) {
		return
	}
	trunks, err := h.svc.List(c.Request.Context())
	if err != nil {
		response.Internal(c, err.Error())
		return
	}
	response.OK(c, trunks)
}

// Get → GET /trunks/:id
func (h *TrunkHandler) Get(c *gin.Context) {
	if !h.requireAdmin(c) {
		return
	}
	id, ok := h.parseID(c)
	if !ok {
		return
	}
	trunk, err := h.svc.Get(c.Request.Context(), id)
	if err != nil {
		h.writeErr(c, err)
		return
	}
	response.OK(c, trunk)
}

// Create → POST /trunks
func (h *TrunkHandler) Create(c *gin.Context) {
	if !h.requireAdmin(c) {
		return
	}
	var input service.TrunkInput
	if err := c.ShouldBindJSON(&input); err != nil {
		response.BadRequest(c, "Invalid request body")
		return
	}
	trunk, err := h.svc.Create(c.Request.Context(), &input)
	if err != nil {
		h.writeErr(c, err)
		return
	}
	response.Created(c, "Trunk created", trunk)
}

// Update → PUT /trunks/:id
func (h *TrunkHandler) Update(c *gin.Context) {
	if !h.requireAdmin(c) {
		return
	}
	id, ok := h.parseID(c)
	if !ok {
		return
	}
	var input service.TrunkInput
	if err := c.ShouldBindJSON(&input); err != nil {
		response.BadRequest(c, "Invalid request body")
		return
	}
	trunk, err := h.svc.Update(c.Request.Context(), id, &input)
	if err != nil {
		h.writeErr(c, err)
		return
	}
	response.Success(c, "Trunk updated", trunk)
}

// Delete → DELETE /trunks/:id
func (h *TrunkHandler) Delete(c *gin.Context) {
	if !h.requireAdmin(c) {
		return
	}
	id, ok := h.parseID(c)
	if !ok {
		return
	}
	if err := h.svc.Delete(c.Request.Context(), id); err != nil {
		h.writeErr(c, err)
		return
	}
	response.Success(c, "Trunk deleted", nil)
}

// Test → POST /trunks/:id/test — fires a SIP OPTIONS ping at the trunk.
func (h *TrunkHandler) Test(c *gin.Context) {
	if !h.requireAdmin(c) {
		return
	}
	id, ok := h.parseID(c)
	if !ok {
		return
	}
	result, err := h.svc.Test(c.Request.Context(), id)
	if err != nil {
		h.writeErr(c, err)
		return
	}
	response.OK(c, result)
}

func (h *TrunkHandler) parseID(c *gin.Context) (uint, bool) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		response.BadRequest(c, "Invalid trunk id")
		return 0, false
	}
	return uint(id), true
}

func (h *TrunkHandler) writeErr(c *gin.Context, err error) {
	switch {
	case errors.Is(err, service.ErrTrunkNotFound):
		response.NotFound(c, err.Error())
	case errors.Is(err, service.ErrTrunkInvalid):
		response.BadRequest(c, err.Error())
	default:
		response.Internal(c, err.Error())
	}
}

// requireAdmin allows the request only when the JWT extension is in the
// configured admin allow-list; otherwise it writes 403 and returns false.
func (h *TrunkHandler) requireAdmin(c *gin.Context) bool {
	ext := c.GetString("extension")
	if ext == "" || !h.admins[ext] {
		response.Error(c, http.StatusForbidden, "Admin access required")
		return false
	}
	return true
}
