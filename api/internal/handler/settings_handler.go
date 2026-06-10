package handler

import (
	"net/http"

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
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, settings)
}

func (h *SettingsHandler) Update(c *gin.Context) {
	ext := c.Param("ext")
	var input service.SettingsInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}

	settings, err := h.settingsSvc.Update(c.Request.Context(), ext, &input)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, settings)
}
