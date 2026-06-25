package handler

import (
	"errors"
	"strconv"

	"github.com/enjoys-in/enjoys-voice/api/internal/middleware"
	"github.com/enjoys-in/enjoys-voice/api/internal/response"
	"github.com/enjoys-in/enjoys-voice/api/internal/service"
	"github.com/gin-gonic/gin"
)

// AiAgentHandler manages each user's per-user AI voice agents. Agents are
// owner-scoped (self-service) — List returns only the caller's own agents, and
// a non-admin may only read/edit/delete the agents they created (admins may
// additionally act on any single agent by id).
type AiAgentHandler struct {
	svc service.AiAgentService
}

func NewAiAgentHandler(svc service.AiAgentService) *AiAgentHandler {
	return &AiAgentHandler{svc: svc}
}

// List → GET /ai-agents : the caller's own agents only.
func (h *AiAgentHandler) List(c *gin.Context) {
	agents, err := h.svc.ListByOwner(c.Request.Context(), c.GetString("extension"))
	if err != nil {
		response.Internal(c, err.Error())
		return
	}
	response.OK(c, agents)
}

// Get → GET /ai-agents/:id : a non-admin may only read an agent they own.
func (h *AiAgentHandler) Get(c *gin.Context) {
	id, ok := h.parseID(c)
	if !ok {
		return
	}
	agent, err := h.svc.Get(c.Request.Context(), id)
	if err != nil {
		h.writeErr(c, err)
		return
	}
	if !h.canAccess(c, agent) {
		response.NotFound(c, "ai agent not found")
		return
	}
	response.OK(c, agent)
}

// Create → POST /ai-agents : the caller becomes the owner.
func (h *AiAgentHandler) Create(c *gin.Context) {
	var input service.AiAgentInput
	if err := c.ShouldBindJSON(&input); err != nil {
		response.BadRequest(c, "Invalid request body")
		return
	}
	agent, err := h.svc.Create(c.Request.Context(), c.GetString("extension"), &input)
	if err != nil {
		h.writeErr(c, err)
		return
	}
	response.Created(c, "AI agent created", agent)
}

// Update → PUT /ai-agents/:id : a non-admin may only update an agent they own.
func (h *AiAgentHandler) Update(c *gin.Context) {
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
		response.NotFound(c, "ai agent not found")
		return
	}
	var input service.AiAgentInput
	if err := c.ShouldBindJSON(&input); err != nil {
		response.BadRequest(c, "Invalid request body")
		return
	}
	agent, err := h.svc.Update(c.Request.Context(), id, &input)
	if err != nil {
		h.writeErr(c, err)
		return
	}
	response.Success(c, "AI agent updated", agent)
}

// Delete → DELETE /ai-agents/:id : a non-admin may only delete an agent they own.
func (h *AiAgentHandler) Delete(c *gin.Context) {
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
		response.NotFound(c, "ai agent not found")
		return
	}
	if err := h.svc.Delete(c.Request.Context(), id); err != nil {
		h.writeErr(c, err)
		return
	}
	response.Success(c, "AI agent deleted", nil)
}

// canAccess reports whether the caller may act on the agent: admins may act on
// any, a regular user only on agents they own.
func (h *AiAgentHandler) canAccess(c *gin.Context, agent *service.AiAgentView) bool {
	return middleware.IsAdmin(c) || agent.OwnerExtension == c.GetString("extension")
}

func (h *AiAgentHandler) parseID(c *gin.Context) (uint, bool) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		response.BadRequest(c, "Invalid ai agent id")
		return 0, false
	}
	return uint(id), true
}

// writeErr maps service errors to the right HTTP status.
func (h *AiAgentHandler) writeErr(c *gin.Context, err error) {
	switch {
	case errors.Is(err, service.ErrAiAgentNotFound):
		response.NotFound(c, err.Error())
	case errors.Is(err, service.ErrAiAgentInvalid):
		response.BadRequest(c, err.Error())
	default:
		response.Internal(c, err.Error())
	}
}
