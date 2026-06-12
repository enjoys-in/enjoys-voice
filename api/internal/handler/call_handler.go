package handler

import (
	"github.com/enjoys-in/enjoys-voice/api/internal/response"
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
		response.Internal(c, "Failed to fetch calls")
		return
	}
	response.OK(c, calls)
}

func (h *CallHandler) GetByExtension(c *gin.Context) {
	ext := c.Param("ext")
	calls, err := h.callSvc.GetByExtension(c.Request.Context(), ext)
	if err != nil {
		response.Internal(c, "Failed to fetch calls")
		return
	}
	response.OK(c, calls)
}
