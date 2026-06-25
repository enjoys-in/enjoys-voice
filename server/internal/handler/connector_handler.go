package handler

import (
	"errors"
	"strconv"

	"github.com/enjoys-in/enjoys-voice/api/internal/middleware"
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

// List → GET /connectors : admins see every connector; a user sees only theirs.
func (h *ConnectorHandler) List(c *gin.Context) {
	ctx := c.Request.Context()
	var (
		conns []service.ConnectorView
		err   error
	)
	if middleware.IsAdmin(c) {
		conns, err = h.svc.List(ctx)
	} else {
		conns, err = h.svc.ListByOwner(ctx, c.GetString("extension"))
	}
	if err != nil {
		response.Internal(c, err.Error())
		return
	}
	response.OK(c, conns)
}

// Get → GET /connectors/:id : a non-admin may only read a connector they own.
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
	if !h.canAccess(c, conn) {
		response.NotFound(c, "connector not found")
		return
	}
	response.OK(c, conn)
}

// Create → POST /connectors : the caller becomes the owner.
func (h *ConnectorHandler) Create(c *gin.Context) {
	var input service.ConnectorInput
	if err := c.ShouldBindJSON(&input); err != nil {
		response.BadRequest(c, "Invalid request body")
		return
	}
	conn, err := h.svc.Create(c.Request.Context(), c.GetString("extension"), &input)
	if err != nil {
		h.writeErr(c, err)
		return
	}
	response.Created(c, "Connector created", conn)
}

// Update → PUT /connectors/:id : a non-admin may only update a connector they own.
func (h *ConnectorHandler) Update(c *gin.Context) {
	id, ok := h.parseID(c)
	if !ok {
		return
	}
	existing, err := h.svc.Get(c.Request.Context(), id)
	if err != nil {
		h.writeErr(c, err)
		return
	}
	if !h.canAccess(c, existing) {
		response.NotFound(c, "connector not found")
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

// Delete → DELETE /connectors/:id : a non-admin may only delete a connector they own.
func (h *ConnectorHandler) Delete(c *gin.Context) {
	id, ok := h.parseID(c)
	if !ok {
		return
	}
	existing, err := h.svc.Get(c.Request.Context(), id)
	if err != nil {
		h.writeErr(c, err)
		return
	}
	if !h.canAccess(c, existing) {
		response.NotFound(c, "connector not found")
		return
	}
	if err := h.svc.Delete(c.Request.Context(), id); err != nil {
		h.writeErr(c, err)
		return
	}
	response.Success(c, "Connector deleted", nil)
}

// canAccess reports whether the caller may act on conn: admins may act on any,
// a regular user only on connectors they own.
func (h *ConnectorHandler) canAccess(c *gin.Context, conn *service.ConnectorView) bool {
	return middleware.IsAdmin(c) || conn.OwnerExtension == c.GetString("extension")
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
