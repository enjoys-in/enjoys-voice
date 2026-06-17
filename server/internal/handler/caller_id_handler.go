package handler

import (
	"errors"
	"net/http"

	"github.com/enjoys-in/enjoys-voice/api/internal/response"
	"github.com/enjoys-in/enjoys-voice/api/internal/service"
	"github.com/gin-gonic/gin"
)

// CallerIDHandler exposes the BYON outbound caller-ID verification endpoints.
// The extension is always taken from the JWT (never the body/path) so a user
// can only manage their own caller ID.
type CallerIDHandler struct {
	svc service.CallerIDService
}

func NewCallerIDHandler(svc service.CallerIDService) *CallerIDHandler {
	return &CallerIDHandler{svc: svc}
}

type callerIDStartRequest struct {
	Number      string `json:"number"`
	CountryCode string `json:"countryCode"`
}

// Start → POST /caller-id/verify/start
func (h *CallerIDHandler) Start(c *gin.Context) {
	ext := c.GetString("extension")
	if ext == "" {
		response.Unauthorized(c, "Missing extension")
		return
	}

	var req callerIDStartRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "Invalid request body")
		return
	}
	if req.Number == "" {
		response.BadRequest(c, "Phone number is required")
		return
	}

	res, err := h.svc.StartVerification(c.Request.Context(), ext, req.Number, req.CountryCode)
	if err != nil {
		h.mapError(c, err)
		return
	}
	response.Success(c, "Verification started. Twilio will call your number — enter the code shown.", res)
}

// Confirm → POST /caller-id/verify/confirm
func (h *CallerIDHandler) Confirm(c *gin.Context) {
	ext := c.GetString("extension")
	if ext == "" {
		response.Unauthorized(c, "Missing extension")
		return
	}

	res, err := h.svc.ConfirmVerification(c.Request.Context(), ext)
	if err != nil {
		h.mapError(c, err)
		return
	}
	response.OK(c, res)
}

// Get → GET /caller-id
func (h *CallerIDHandler) Get(c *gin.Context) {
	ext := c.GetString("extension")
	if ext == "" {
		response.Unauthorized(c, "Missing extension")
		return
	}

	res, err := h.svc.Get(c.Request.Context(), ext)
	if err != nil {
		response.Internal(c, err.Error())
		return
	}
	response.OK(c, res)
}

// Delete → DELETE /caller-id
func (h *CallerIDHandler) Delete(c *gin.Context) {
	ext := c.GetString("extension")
	if ext == "" {
		response.Unauthorized(c, "Missing extension")
		return
	}

	if err := h.svc.Delete(c.Request.Context(), ext); err != nil {
		h.mapError(c, err)
		return
	}
	response.Success(c, "Caller ID removed", nil)
}

// mapError translates service sentinel errors to appropriate HTTP statuses.
func (h *CallerIDHandler) mapError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, service.ErrCallerIDUnavailable):
		response.Error(c, http.StatusServiceUnavailable, err.Error())
	case errors.Is(err, service.ErrCallerIDCooldown):
		response.Error(c, http.StatusTooManyRequests, err.Error())
	default:
		response.BadRequest(c, err.Error())
	}
}
