package handler

import (
	"errors"
	"strconv"

	"github.com/enjoys-in/enjoys-voice/api/internal/response"
	"github.com/enjoys-in/enjoys-voice/api/internal/service"
	"github.com/gin-gonic/gin"
)

// APIKeyHandler manages developer API keys for the embeddable click-to-call
// widget. Every endpoint is OWNER-SCOPED: the owning extension is taken from the
// JWT (never the body/path), so a user can only list/create/modify their own
// keys. Keys are not admin-gated — any authenticated user can mint keys for
// their own number.
type APIKeyHandler struct {
	svc service.APIKeyService
}

func NewAPIKeyHandler(svc service.APIKeyService) *APIKeyHandler {
	return &APIKeyHandler{svc: svc}
}

// List → GET /api-keys
func (h *APIKeyHandler) List(c *gin.Context) {
	owner, ok := h.owner(c)
	if !ok {
		return
	}
	keys, err := h.svc.List(c.Request.Context(), owner)
	if err != nil {
		response.Internal(c, err.Error())
		return
	}
	response.OK(c, keys)
}

// Create → POST /api-keys
func (h *APIKeyHandler) Create(c *gin.Context) {
	owner, ok := h.owner(c)
	if !ok {
		return
	}
	var input service.APIKeyInput
	if err := c.ShouldBindJSON(&input); err != nil {
		response.BadRequest(c, "Invalid request body")
		return
	}
	key, err := h.svc.Create(c.Request.Context(), owner, &input)
	if err != nil {
		h.writeErr(c, err)
		return
	}
	response.Created(c, "API key created", key)
}

// Update → PUT /api-keys/:id
func (h *APIKeyHandler) Update(c *gin.Context) {
	owner, ok := h.owner(c)
	if !ok {
		return
	}
	id, ok := h.parseID(c)
	if !ok {
		return
	}
	var input service.APIKeyInput
	if err := c.ShouldBindJSON(&input); err != nil {
		response.BadRequest(c, "Invalid request body")
		return
	}
	key, err := h.svc.Update(c.Request.Context(), owner, id, &input)
	if err != nil {
		h.writeErr(c, err)
		return
	}
	response.Success(c, "API key updated", key)
}

// Delete → DELETE /api-keys/:id
func (h *APIKeyHandler) Delete(c *gin.Context) {
	owner, ok := h.owner(c)
	if !ok {
		return
	}
	id, ok := h.parseID(c)
	if !ok {
		return
	}
	if err := h.svc.Delete(c.Request.Context(), owner, id); err != nil {
		h.writeErr(c, err)
		return
	}
	response.Success(c, "API key revoked", nil)
}

func (h *APIKeyHandler) owner(c *gin.Context) (string, bool) {
	ext := c.GetString("extension")
	if ext == "" {
		response.Unauthorized(c, "Missing extension")
		return "", false
	}
	return ext, true
}

func (h *APIKeyHandler) parseID(c *gin.Context) (uint, bool) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		response.BadRequest(c, "Invalid api key id")
		return 0, false
	}
	return uint(id), true
}

func (h *APIKeyHandler) writeErr(c *gin.Context, err error) {
	switch {
	case errors.Is(err, service.ErrAPIKeyNotFound):
		response.NotFound(c, err.Error())
	case errors.Is(err, service.ErrAPIKeyInvalid):
		response.BadRequest(c, err.Error())
	default:
		response.Internal(c, err.Error())
	}
}
