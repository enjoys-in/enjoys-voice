package handler

import (
	"errors"
	"strconv"

	"github.com/enjoys-in/enjoys-voice/api/internal/middleware"
	"github.com/enjoys-in/enjoys-voice/api/internal/response"
	"github.com/enjoys-in/enjoys-voice/api/internal/service"
	"github.com/gin-gonic/gin"
)

// RoutingRuleHandler manages each user's per-user inbound call-routing rules.
// Rules are owner-scoped (self-service) — List returns only the caller's own
// rules, and a non-admin may only read/edit/delete the rules they created
// (admins may additionally act on any single rule by id).
type RoutingRuleHandler struct {
	svc service.RoutingRuleService
}

func NewRoutingRuleHandler(svc service.RoutingRuleService) *RoutingRuleHandler {
	return &RoutingRuleHandler{svc: svc}
}

// List → GET /routing-rules : the caller's own rules only.
func (h *RoutingRuleHandler) List(c *gin.Context) {
	rules, err := h.svc.ListByOwner(c.Request.Context(), c.GetString("extension"))
	if err != nil {
		response.Internal(c, err.Error())
		return
	}
	response.OK(c, rules)
}

// Get → GET /routing-rules/:id : a non-admin may only read a rule they own.
func (h *RoutingRuleHandler) Get(c *gin.Context) {
	id, ok := h.parseID(c)
	if !ok {
		return
	}
	rule, err := h.svc.Get(c.Request.Context(), id)
	if err != nil {
		h.writeErr(c, err)
		return
	}
	if !h.canAccess(c, rule) {
		response.NotFound(c, "routing rule not found")
		return
	}
	response.OK(c, rule)
}

// Create → POST /routing-rules : the caller becomes the owner.
func (h *RoutingRuleHandler) Create(c *gin.Context) {
	var input service.RoutingRuleInput
	if err := c.ShouldBindJSON(&input); err != nil {
		response.BadRequest(c, "Invalid request body")
		return
	}
	rule, err := h.svc.Create(c.Request.Context(), c.GetString("extension"), &input)
	if err != nil {
		h.writeErr(c, err)
		return
	}
	response.Created(c, "Routing rule created", rule)
}

// Update → PUT /routing-rules/:id : a non-admin may only update a rule they own.
func (h *RoutingRuleHandler) Update(c *gin.Context) {
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
		response.NotFound(c, "routing rule not found")
		return
	}
	var input service.RoutingRuleInput
	if err := c.ShouldBindJSON(&input); err != nil {
		response.BadRequest(c, "Invalid request body")
		return
	}
	rule, err := h.svc.Update(c.Request.Context(), id, &input)
	if err != nil {
		h.writeErr(c, err)
		return
	}
	response.Success(c, "Routing rule updated", rule)
}

// Delete → DELETE /routing-rules/:id : a non-admin may only delete a rule they own.
func (h *RoutingRuleHandler) Delete(c *gin.Context) {
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
		response.NotFound(c, "routing rule not found")
		return
	}
	if err := h.svc.Delete(c.Request.Context(), id); err != nil {
		h.writeErr(c, err)
		return
	}
	response.Success(c, "Routing rule deleted", nil)
}

// canAccess reports whether the caller may act on the rule: admins may act on
// any, a regular user only on rules they own.
func (h *RoutingRuleHandler) canAccess(c *gin.Context, rule *service.RoutingRuleView) bool {
	return middleware.IsAdmin(c) || rule.OwnerExtension == c.GetString("extension")
}

func (h *RoutingRuleHandler) parseID(c *gin.Context) (uint, bool) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		response.BadRequest(c, "Invalid routing rule id")
		return 0, false
	}
	return uint(id), true
}

// writeErr maps service errors to the right HTTP status.
func (h *RoutingRuleHandler) writeErr(c *gin.Context, err error) {
	switch {
	case errors.Is(err, service.ErrRoutingRuleNotFound):
		response.NotFound(c, err.Error())
	case errors.Is(err, service.ErrRoutingRuleInvalid):
		response.BadRequest(c, err.Error())
	default:
		response.Internal(c, err.Error())
	}
}
