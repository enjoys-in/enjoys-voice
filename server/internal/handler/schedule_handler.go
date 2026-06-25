package handler

import (
	"errors"
	"net/http"

	"github.com/enjoys-in/enjoys-voice/api/internal/response"
	"github.com/enjoys-in/enjoys-voice/api/internal/service"
	"github.com/gin-gonic/gin"
)

// ScheduleHandler exposes the global business-hours policy and per-user
// availability windows. All timing is global config managed by admins, so
// every write (business hours and per-user availability) is gated by the
// ADMIN_EXTENSIONS allow-list; reads stay available to authenticated users.
type ScheduleHandler struct {
	svc    service.ScheduleService
	admins map[string]bool
}

func NewScheduleHandler(svc service.ScheduleService, adminExtensions []string) *ScheduleHandler {
	admins := make(map[string]bool, len(adminExtensions))
	for _, ext := range adminExtensions {
		if ext != "" {
			admins[ext] = true
		}
	}
	return &ScheduleHandler{svc: svc, admins: admins}
}

// GetBusinessHours → GET /business-hours
func (h *ScheduleHandler) GetBusinessHours(c *gin.Context) {
	policy, err := h.svc.GetBusinessHours(c.Request.Context())
	if err != nil {
		response.Internal(c, err.Error())
		return
	}
	response.OK(c, policy)
}

// SaveBusinessHours → PUT /business-hours (admin-only)
func (h *ScheduleHandler) SaveBusinessHours(c *gin.Context) {
	if !h.requireAdmin(c) {
		return
	}
	var input service.BusinessHoursInput
	if err := c.ShouldBindJSON(&input); err != nil {
		response.BadRequest(c, "Invalid request body")
		return
	}
	policy, err := h.svc.SaveBusinessHours(c.Request.Context(), &input)
	if err != nil {
		h.writeErr(c, err)
		return
	}
	response.Success(c, "Business hours updated", policy)
}

// ListAvailability → GET /availability/:ext
func (h *ScheduleHandler) ListAvailability(c *gin.Context) {
	ext := c.Param("ext")
	windows, err := h.svc.ListAvailability(c.Request.Context(), ext)
	if err != nil {
		response.Internal(c, err.Error())
		return
	}
	response.OK(c, windows)
}

// SaveAvailability → PUT /availability/:ext (admin-only)
func (h *ScheduleHandler) SaveAvailability(c *gin.Context) {
	if !h.requireAdmin(c) {
		return
	}
	ext := c.Param("ext")
	var input service.AvailabilityInput
	if err := c.ShouldBindJSON(&input); err != nil {
		response.BadRequest(c, "Invalid request body")
		return
	}
	windows, err := h.svc.SaveAvailability(c.Request.Context(), ext, &input)
	if err != nil {
		h.writeErr(c, err)
		return
	}
	response.Success(c, "Availability updated", windows)
}

// GetPrompts → GET /routing-prompts : stored announcement-wording overrides
// (public read so the engine/UI can resolve effective wording).
func (h *ScheduleHandler) GetPrompts(c *gin.Context) {
	prompts, err := h.svc.GetPrompts(c.Request.Context())
	if err != nil {
		response.Internal(c, err.Error())
		return
	}
	response.OK(c, prompts)
}

// SavePrompts → PUT /routing-prompts (admin-only) : replace the override set.
func (h *ScheduleHandler) SavePrompts(c *gin.Context) {
	if !h.requireAdmin(c) {
		return
	}
	var input struct {
		Prompts []service.PromptInput `json:"prompts"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		response.BadRequest(c, "Invalid request body")
		return
	}
	prompts, err := h.svc.SavePrompts(c.Request.Context(), input.Prompts)
	if err != nil {
		h.writeErr(c, err)
		return
	}
	response.Success(c, "Announcement prompts updated", prompts)
}

func (h *ScheduleHandler) writeErr(c *gin.Context, err error) {
	if errors.Is(err, service.ErrScheduleInvalid) || errors.Is(err, service.ErrPromptKeyInvalid) {
		response.BadRequest(c, err.Error())
		return
	}
	response.Internal(c, err.Error())
}

// requireAdmin allows the request only when the JWT extension is in the
// configured admin allow-list; otherwise it writes 403 and returns false.
func (h *ScheduleHandler) requireAdmin(c *gin.Context) bool {
	ext := c.GetString("extension")
	if ext == "" || !h.admins[ext] {
		response.Error(c, http.StatusForbidden, "Admin access required")
		return false
	}
	return true
}
