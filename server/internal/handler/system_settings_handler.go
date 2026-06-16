package handler

import (
	"github.com/enjoys-in/enjoys-voice/api/internal/response"
	"github.com/enjoys-in/enjoys-voice/api/internal/service"
	"github.com/gin-gonic/gin"
)

type SystemSettingsHandler struct {
	svc service.SystemSettingsService
}

func NewSystemSettingsHandler(svc service.SystemSettingsService) *SystemSettingsHandler {
	return &SystemSettingsHandler{svc: svc}
}

// Get → GET /system-settings
func (h *SystemSettingsHandler) Get(c *gin.Context) {
	settings, err := h.svc.Get(c.Request.Context())
	if err != nil {
		response.Internal(c, err.Error())
		return
	}
	response.OK(c, settings)
}

// Update → PUT /system-settings
func (h *SystemSettingsHandler) Update(c *gin.Context) {
	var input service.SystemSettingsInput
	if err := c.ShouldBindJSON(&input); err != nil {
		response.BadRequest(c, "Invalid request body")
		return
	}

	settings, err := h.svc.Update(c.Request.Context(), &input)
	if err != nil {
		response.Internal(c, err.Error())
		return
	}
	response.Success(c, "System settings updated", settings)
}
