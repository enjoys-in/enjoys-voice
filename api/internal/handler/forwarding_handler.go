package handler

import (
	"net/http"

	"github.com/enjoys-in/enjoys-voice/api/internal/service"
	"github.com/gin-gonic/gin"
)

type ForwardingHandler struct {
	fwdSvc service.ForwardingService
}

func NewForwardingHandler(fs service.ForwardingService) *ForwardingHandler {
	return &ForwardingHandler{fwdSvc: fs}
}

func (h *ForwardingHandler) Get(c *gin.Context) {
	ext := c.Param("ext")
	fwd, err := h.fwdSvc.Get(c.Request.Context(), ext)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch forwarding"})
		return
	}
	c.JSON(http.StatusOK, fwd)
}

type forwardingRequest struct {
	Type   string `json:"type" binding:"required,oneof=busy noAnswer unavailable"`
	Target string `json:"target"`
}

func (h *ForwardingHandler) Set(c *gin.Context) {
	ext := c.Param("ext")
	var req forwardingRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid type (busy | noAnswer | unavailable)"})
		return
	}

	if err := h.fwdSvc.Set(c.Request.Context(), ext, req.Type, req.Target); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true})
}
