package handler

import (
	"errors"
	"io"
	"strconv"
	"strings"

	"github.com/enjoys-in/enjoys-voice/api/internal/response"
	"github.com/enjoys-in/enjoys-voice/api/internal/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type RateHandler struct {
	svc service.RateService
}

func NewRateHandler(svc service.RateService) *RateHandler {
	return &RateHandler{svc: svc}
}

// parseUintParam reads a uint path param, writing a 400 and returning ok=false
// when it is missing or non-numeric.
func parseUintParam(c *gin.Context, name string) (uint, bool) {
	v, err := strconv.ParseUint(c.Param(name), 10, 64)
	if err != nil {
		response.BadRequest(c, "Invalid "+name)
		return 0, false
	}
	return uint(v), true
}

// ─── Rate plans ──────────────────────────────────────────

// ListPlans → GET /rate-plans
func (h *RateHandler) ListPlans(c *gin.Context) {
	plans, err := h.svc.ListPlans(c.Request.Context())
	if err != nil {
		response.Internal(c, "Failed to fetch rate plans")
		return
	}
	response.OK(c, plans)
}

// GetPlan → GET /rate-plans/:id (plan + its rates)
func (h *RateHandler) GetPlan(c *gin.Context) {
	id, ok := parseUintParam(c, "id")
	if !ok {
		return
	}
	plan, err := h.svc.GetPlan(c.Request.Context(), id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			response.NotFound(c, "Rate plan not found")
			return
		}
		response.Internal(c, "Failed to fetch rate plan")
		return
	}
	response.OK(c, plan)
}

// CreatePlan → POST /rate-plans
func (h *RateHandler) CreatePlan(c *gin.Context) {
	var input service.RatePlanInput
	if err := c.ShouldBindJSON(&input); err != nil {
		response.BadRequest(c, "Invalid request body")
		return
	}
	plan, err := h.svc.CreatePlan(c.Request.Context(), &input)
	if err != nil {
		response.BadRequest(c, err.Error())
		return
	}
	response.Created(c, "Rate plan created", plan)
}

// UpdatePlan → PUT /rate-plans/:id
func (h *RateHandler) UpdatePlan(c *gin.Context) {
	id, ok := parseUintParam(c, "id")
	if !ok {
		return
	}
	var input service.RatePlanInput
	if err := c.ShouldBindJSON(&input); err != nil {
		response.BadRequest(c, "Invalid request body")
		return
	}
	plan, err := h.svc.UpdatePlan(c.Request.Context(), id, &input)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			response.NotFound(c, "Rate plan not found")
			return
		}
		response.BadRequest(c, err.Error())
		return
	}
	response.Success(c, "Rate plan updated", plan)
}

// DeletePlan → DELETE /rate-plans/:id
func (h *RateHandler) DeletePlan(c *gin.Context) {
	id, ok := parseUintParam(c, "id")
	if !ok {
		return
	}
	if err := h.svc.DeletePlan(c.Request.Context(), id); err != nil {
		response.Internal(c, "Failed to delete rate plan")
		return
	}
	response.Success(c, "Rate plan deleted", gin.H{"id": id})
}

// ─── Rates ───────────────────────────────────────────────

// ListRates → GET /rate-plans/:id/rates
func (h *RateHandler) ListRates(c *gin.Context) {
	planID, ok := parseUintParam(c, "id")
	if !ok {
		return
	}
	rates, err := h.svc.ListRates(c.Request.Context(), planID)
	if err != nil {
		response.Internal(c, "Failed to fetch rates")
		return
	}
	response.OK(c, rates)
}

// CreateRate → POST /rate-plans/:id/rates
func (h *RateHandler) CreateRate(c *gin.Context) {
	planID, ok := parseUintParam(c, "id")
	if !ok {
		return
	}
	var input service.RateInput
	if err := c.ShouldBindJSON(&input); err != nil {
		response.BadRequest(c, "Invalid request body")
		return
	}
	rate, err := h.svc.CreateRate(c.Request.Context(), planID, &input)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			response.NotFound(c, "Rate plan not found")
			return
		}
		response.BadRequest(c, err.Error())
		return
	}
	response.Created(c, "Rate created", rate)
}

// UpdateRate → PUT /rate-plans/:id/rates/:rateId
func (h *RateHandler) UpdateRate(c *gin.Context) {
	rateID, ok := parseUintParam(c, "rateId")
	if !ok {
		return
	}
	var input service.RateInput
	if err := c.ShouldBindJSON(&input); err != nil {
		response.BadRequest(c, "Invalid request body")
		return
	}
	rate, err := h.svc.UpdateRate(c.Request.Context(), rateID, &input)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			response.NotFound(c, "Rate not found")
			return
		}
		response.BadRequest(c, err.Error())
		return
	}
	response.Success(c, "Rate updated", rate)
}

// DeleteRate → DELETE /rate-plans/:id/rates/:rateId
func (h *RateHandler) DeleteRate(c *gin.Context) {
	rateID, ok := parseUintParam(c, "rateId")
	if !ok {
		return
	}
	if err := h.svc.DeleteRate(c.Request.Context(), rateID); err != nil {
		response.Internal(c, "Failed to delete rate")
		return
	}
	response.Success(c, "Rate deleted", gin.H{"id": rateID})
}

// ImportRates → POST /rate-plans/:id/rates/import
// Accepts either a raw CSV body (Content-Type text/csv or text/plain) or a JSON
// body { "csv": "prefix,description,sell,buy,setup,increment,min\n..." }. Rows
// are upserted keyed on prefix; existing prefixes are overwritten.
func (h *RateHandler) ImportRates(c *gin.Context) {
	planID, ok := parseUintParam(c, "id")
	if !ok {
		return
	}

	csvData := ""
	if strings.HasPrefix(c.ContentType(), "application/json") {
		var body struct {
			CSV string `json:"csv"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			response.BadRequest(c, "Invalid request body")
			return
		}
		csvData = body.CSV
	} else {
		raw, err := io.ReadAll(c.Request.Body)
		if err != nil {
			response.BadRequest(c, "Could not read request body")
			return
		}
		csvData = string(raw)
	}

	if strings.TrimSpace(csvData) == "" {
		response.BadRequest(c, "No CSV data provided")
		return
	}

	result, err := h.svc.ImportRates(c.Request.Context(), planID, csvData)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			response.NotFound(c, "Rate plan not found")
			return
		}
		response.BadRequest(c, err.Error())
		return
	}
	response.Success(c, "Rates imported", result)
}
