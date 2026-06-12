package handler

import (
	"github.com/enjoys-in/enjoys-voice/api/internal/response"
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
		response.Internal(c, "Failed to fetch forwarding")
		return
	}
	response.OK(c, fwd)
}

type forwardingRequest struct {
	Type   string `json:"type" binding:"required,oneof=busy noAnswer unavailable"`
	Target string `json:"target"`
}

func (h *ForwardingHandler) Set(c *gin.Context) {
	ext := c.Param("ext")
	var req forwardingRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "Invalid type (busy | noAnswer | unavailable)")
		return
	}

	if err := h.fwdSvc.Set(c.Request.Context(), ext, req.Type, req.Target); err != nil {
		response.Internal(c, err.Error())
		return
	}

	response.Success(c, "Forwarding updated", nil)
}
