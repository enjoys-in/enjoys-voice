package handler

import (
	"net/http"

	"github.com/enjoys-in/enjoys-voice/api/internal/service"
	"github.com/gin-gonic/gin"
)

type CallHandler struct {
	callSvc service.CallService
}

func NewCallHandler(cs service.CallService) *CallHandler {
	return &CallHandler{callSvc: cs}
}

func (h *CallHandler) GetAll(c *gin.Context) {
	calls, err := h.callSvc.GetAll(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch calls"})
		return
	}
	c.JSON(http.StatusOK, calls)
}

func (h *CallHandler) GetByExtension(c *gin.Context) {
	ext := c.Param("ext")
	calls, err := h.callSvc.GetByExtension(c.Request.Context(), ext)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch calls"})
		return
	}
	c.JSON(http.StatusOK, calls)
}
