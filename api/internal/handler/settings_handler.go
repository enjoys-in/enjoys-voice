package handler

import (
	"github.com/enjoys-in/enjoys-voice/api/internal/response"
	"github.com/enjoys-in/enjoys-voice/api/internal/service"
	"github.com/gin-gonic/gin"
)

type SettingsHandler struct {
	settingsSvc service.SettingsService
}

func NewSettingsHandler(ss service.SettingsService) *SettingsHandler {
	return &SettingsHandler{settingsSvc: ss}
}

func (h *SettingsHandler) Get(c *gin.Context) {
	ext := c.Param("ext")
	settings, err := h.settingsSvc.Get(c.Request.Context(), ext)
	if err != nil {
		response.NotFound(c, err.Error())
		return
	}
	response.OK(c, settings)
}

func (h *SettingsHandler) Update(c *gin.Context) {
	ext := c.Param("ext")
	var input service.SettingsInput
	if err := c.ShouldBindJSON(&input); err != nil {
		response.BadRequest(c, "Invalid request body")
		return
	}

	settings, err := h.settingsSvc.Update(c.Request.Context(), ext, &input)
	if err != nil {
		response.Internal(c, err.Error())
		return
	}

	response.Success(c, "Settings updated", settings)
}

// GetPstnForward → GET /pstn-forward/:ext
func (h *SettingsHandler) GetPstnForward(c *gin.Context) {
	ext := c.Param("ext")
	pstn, err := h.settingsSvc.GetPstnForward(c.Request.Context(), ext)
	if err != nil {
		response.Internal(c, "Failed to fetch PSTN forwarding")
		return
	}
	response.OK(c, pstn)
}

type pstnForwardRequest struct {
	Enabled bool   `json:"enabled"`
	Target  string `json:"target"`
}

// SetPstnForward → POST /pstn-forward/:ext
func (h *SettingsHandler) SetPstnForward(c *gin.Context) {
	ext := c.Param("ext")
	var req pstnForwardRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "Invalid request body")
		return
	}

	pstn, err := h.settingsSvc.SetPstnForward(c.Request.Context(), ext, req.Enabled, req.Target)
	if err != nil {
		response.Internal(c, err.Error())
		return
	}
	response.Success(c, "PSTN forwarding updated", pstn)
}
