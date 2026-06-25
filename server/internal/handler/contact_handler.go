package handler

import (
	"errors"
	"strconv"

	"github.com/enjoys-in/enjoys-voice/api/internal/middleware"
	"github.com/enjoys-in/enjoys-voice/api/internal/response"
	"github.com/enjoys-in/enjoys-voice/api/internal/service"
	"github.com/gin-gonic/gin"
)

// ContactHandler manages each user's personal address book. Contacts are
// owner-scoped — List returns only the caller's own contacts, and a non-admin
// may only read/edit/delete the contacts they created (admins may additionally
// act on any single contact by id).
type ContactHandler struct {
	svc service.ContactService
}

func NewContactHandler(svc service.ContactService) *ContactHandler {
	return &ContactHandler{svc: svc}
}

// List → GET /contacts : the caller's own contacts only.
func (h *ContactHandler) List(c *gin.Context) {
	contacts, err := h.svc.ListByOwner(c.Request.Context(), c.GetString("extension"))
	if err != nil {
		response.Internal(c, err.Error())
		return
	}
	response.OK(c, contacts)
}

// Get → GET /contacts/:id : a non-admin may only read a contact they own.
func (h *ContactHandler) Get(c *gin.Context) {
	id, ok := h.parseID(c)
	if !ok {
		return
	}
	contact, err := h.svc.Get(c.Request.Context(), id)
	if err != nil {
		h.writeErr(c, err)
		return
	}
	if !h.canAccess(c, contact) {
		response.NotFound(c, "contact not found")
		return
	}
	response.OK(c, contact)
}

// Create → POST /contacts : the caller becomes the owner.
func (h *ContactHandler) Create(c *gin.Context) {
	var input service.ContactInput
	if err := c.ShouldBindJSON(&input); err != nil {
		response.BadRequest(c, "Invalid request body")
		return
	}
	contact, err := h.svc.Create(c.Request.Context(), c.GetString("extension"), &input)
	if err != nil {
		h.writeErr(c, err)
		return
	}
	response.Created(c, "Contact created", contact)
}

// Update → PUT /contacts/:id : a non-admin may only update a contact they own.
func (h *ContactHandler) Update(c *gin.Context) {
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
		response.NotFound(c, "contact not found")
		return
	}
	var input service.ContactInput
	if err := c.ShouldBindJSON(&input); err != nil {
		response.BadRequest(c, "Invalid request body")
		return
	}
	contact, err := h.svc.Update(c.Request.Context(), id, &input)
	if err != nil {
		h.writeErr(c, err)
		return
	}
	response.Success(c, "Contact updated", contact)
}

// Delete → DELETE /contacts/:id : a non-admin may only delete a contact they own.
func (h *ContactHandler) Delete(c *gin.Context) {
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
		response.NotFound(c, "contact not found")
		return
	}
	if err := h.svc.Delete(c.Request.Context(), id); err != nil {
		h.writeErr(c, err)
		return
	}
	response.Success(c, "Contact deleted", nil)
}

// canAccess reports whether the caller may act on the contact: admins may act on
// any, a regular user only on contacts they own.
func (h *ContactHandler) canAccess(c *gin.Context, contact *service.ContactView) bool {
	return middleware.IsAdmin(c) || contact.OwnerExtension == c.GetString("extension")
}

func (h *ContactHandler) parseID(c *gin.Context) (uint, bool) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		response.BadRequest(c, "Invalid contact id")
		return 0, false
	}
	return uint(id), true
}

// writeErr maps service errors to the right HTTP status.
func (h *ContactHandler) writeErr(c *gin.Context, err error) {
	switch {
	case errors.Is(err, service.ErrContactNotFound):
		response.NotFound(c, err.Error())
	case errors.Is(err, service.ErrContactInvalid):
		response.BadRequest(c, err.Error())
	default:
		response.Internal(c, err.Error())
	}
}
