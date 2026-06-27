package handler

import (
	"errors"
	"strconv"

	"github.com/enjoys-in/enjoys-voice/api/internal/middleware"
	"github.com/enjoys-in/enjoys-voice/api/internal/response"
	"github.com/enjoys-in/enjoys-voice/api/internal/service"
	"github.com/gin-gonic/gin"
)

// WebhookHandler manages each user's per-user outbound call-event webhooks.
// Webhooks are owner-scoped (self-service) — List returns only the caller's own
// webhooks, and a non-admin may only read/edit/delete the webhooks they created
// (admins may additionally act on any single webhook by id).
type WebhookHandler struct {
	svc service.WebhookService
}

func NewWebhookHandler(svc service.WebhookService) *WebhookHandler {
	return &WebhookHandler{svc: svc}
}

// List → GET /webhooks : the caller's own webhooks only.
func (h *WebhookHandler) List(c *gin.Context) {
	hooks, err := h.svc.ListByOwner(c.Request.Context(), c.GetString("extension"))
	if err != nil {
		response.Internal(c, err.Error())
		return
	}
	response.OK(c, hooks)
}

// Get → GET /webhooks/:id : a non-admin may only read a webhook they own.
func (h *WebhookHandler) Get(c *gin.Context) {
	id, ok := h.parseID(c)
	if !ok {
		return
	}
	hook, err := h.svc.Get(c.Request.Context(), id)
	if err != nil {
		h.writeErr(c, err)
		return
	}
	if !h.canAccess(c, hook) {
		response.NotFound(c, "webhook not found")
		return
	}
	response.OK(c, hook)
}

// Create → POST /webhooks : the caller becomes the owner.
func (h *WebhookHandler) Create(c *gin.Context) {
	var input service.WebhookInput
	if err := c.ShouldBindJSON(&input); err != nil {
		response.BadRequest(c, "Invalid request body")
		return
	}
	hook, err := h.svc.Create(c.Request.Context(), c.GetString("extension"), &input)
	if err != nil {
		h.writeErr(c, err)
		return
	}
	response.Created(c, "Webhook created", hook)
}

// Update → PUT /webhooks/:id : a non-admin may only update a webhook they own.
func (h *WebhookHandler) Update(c *gin.Context) {
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
		response.NotFound(c, "webhook not found")
		return
	}
	var input service.WebhookInput
	if err := c.ShouldBindJSON(&input); err != nil {
		response.BadRequest(c, "Invalid request body")
		return
	}
	hook, err := h.svc.Update(c.Request.Context(), id, &input)
	if err != nil {
		h.writeErr(c, err)
		return
	}
	response.Success(c, "Webhook updated", hook)
}

// Delete → DELETE /webhooks/:id : a non-admin may only delete a webhook they own.
func (h *WebhookHandler) Delete(c *gin.Context) {
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
		response.NotFound(c, "webhook not found")
		return
	}
	if err := h.svc.Delete(c.Request.Context(), id); err != nil {
		h.writeErr(c, err)
		return
	}
	response.Success(c, "Webhook deleted", nil)
}

// canAccess reports whether the caller may act on the webhook: admins may act on
// any, a regular user only on webhooks they own.
func (h *WebhookHandler) canAccess(c *gin.Context, hook *service.WebhookView) bool {
	return middleware.IsAdmin(c) || hook.OwnerExtension == c.GetString("extension")
}

func (h *WebhookHandler) parseID(c *gin.Context) (uint, bool) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		response.BadRequest(c, "Invalid webhook id")
		return 0, false
	}
	return uint(id), true
}

// writeErr maps service errors to the right HTTP status.
func (h *WebhookHandler) writeErr(c *gin.Context, err error) {
	switch {
	case errors.Is(err, service.ErrWebhookNotFound):
		response.NotFound(c, err.Error())
	case errors.Is(err, service.ErrWebhookInvalid):
		response.BadRequest(c, err.Error())
	default:
		response.Internal(c, err.Error())
	}
}
