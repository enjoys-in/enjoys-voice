package handler

import (
	"errors"
	"strconv"

	"github.com/enjoys-in/enjoys-voice/api/internal/response"
	"github.com/enjoys-in/enjoys-voice/api/internal/service"
	"github.com/gin-gonic/gin"
)

// ConnectorHandler manages outbound integration connectors (email / webhook)
// the IVR flow builder can trigger. Secrets are never serialized back — the
// service redacts them and reports HasSecret instead.
type ConnectorHandler struct {
	svc service.ConnectorService
}

func NewConnectorHandler(svc service.ConnectorService) *ConnectorHandler {
	return &ConnectorHandler{svc: svc}
}

// List → GET /connectors
func (h *ConnectorHandler) List(c *gin.Context) {
	conns, err := h.svc.List(c.Request.Context())
	if err != nil {
		response.Internal(c, err.Error())
		return
	}
	response.OK(c, conns)
}

// Get → GET /connectors/:id
func (h *ConnectorHandler) Get(c *gin.Context) {
	id, ok := h.parseID(c)
	if !ok {
		return
	}
	conn, err := h.svc.Get(c.Request.Context(), id)
	if err != nil {
		h.writeErr(c, err)
		return
	}
	response.OK(c, conn)
}

// Create → POST /connectors
func (h *ConnectorHandler) Create(c *gin.Context) {
	var input service.ConnectorInput
	if err := c.ShouldBindJSON(&input); err != nil {
		response.BadRequest(c, "Invalid request body")
		return
	}
	conn, err := h.svc.Create(c.Request.Context(), &input)
	if err != nil {
		h.writeErr(c, err)
		return
	}
	response.Created(c, "Connector created", conn)
}

// Update → PUT /connectors/:id
func (h *ConnectorHandler) Update(c *gin.Context) {
	id, ok := h.parseID(c)
	if !ok {
		return
	}
	var input service.ConnectorInput
	if err := c.ShouldBindJSON(&input); err != nil {
		response.BadRequest(c, "Invalid request body")
		return
	}
	conn, err := h.svc.Update(c.Request.Context(), id, &input)
	if err != nil {
		h.writeErr(c, err)
		return
	}
	response.Success(c, "Connector updated", conn)
}

// Delete → DELETE /connectors/:id
func (h *ConnectorHandler) Delete(c *gin.Context) {
	id, ok := h.parseID(c)
	if !ok {
		return
	}
	if err := h.svc.Delete(c.Request.Context(), id); err != nil {
		h.writeErr(c, err)
		return
	}
	response.Success(c, "Connector deleted", nil)
}

func (h *ConnectorHandler) parseID(c *gin.Context) (uint, bool) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		response.BadRequest(c, "Invalid connector id")
		return 0, false
	}
	return uint(id), true
}

func (h *ConnectorHandler) writeErr(c *gin.Context, err error) {
	switch {
	case errors.Is(err, service.ErrConnectorNotFound):
		response.NotFound(c, err.Error())
	case errors.Is(err, service.ErrConnectorInvalid):
		response.BadRequest(c, err.Error())
	default:
		response.Internal(c, err.Error())
	}
}
