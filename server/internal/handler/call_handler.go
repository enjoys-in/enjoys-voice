package handler

import (
	"strconv"
	"time"

	"github.com/enjoys-in/enjoys-voice/api/internal/models"
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

// callResponse is the camelCase shape the web client expects (mirrors the Node
// engine's CallLog / the frontend CallRecord type). The Node SIP engine is the
// sole writer of call history; the Go API only reads the shared call_records
// table, so this maps the stored row to the client contract.
type callResponse struct {
	ID        string  `json:"id"`
	From      string  `json:"from"`
	To        string  `json:"to"`
	FromName  string  `json:"fromName"`
	Status    string  `json:"status"`
	Direction string  `json:"direction"`
	StartTime string  `json:"startTime"`
	EndTime   *string `json:"endTime,omitempty"`
	Duration  int     `json:"duration"`
	Cost      float64 `json:"cost"`
	Currency  string  `json:"currency,omitempty"`
}

func toCallResponse(c models.CallRecord) callResponse {
	// Prefer the SIP Call-ID (stable client key); fall back to the numeric PK
	// for legacy rows written before call_id existed.
	id := c.CallID
	if id == "" {
		id = strconv.FormatUint(uint64(c.ID), 10)
	}
	// Default mirrors Node's loadRecentCalls hydration for legacy NULL rows.
	direction := c.Direction
	if direction == "" {
		direction = "inbound"
	}
	status := c.Status
	if status == "" {
		status = "ended"
	}

	var endTime *string
	if c.EndedAt != nil {
		s := c.EndedAt.UTC().Format(time.RFC3339)
		endTime = &s
	}

	return callResponse{
		ID:        id,
		From:      c.From,
		To:        c.To,
		FromName:  c.FromName,
		Status:    status,
		Direction: direction,
		StartTime: c.StartedAt.UTC().Format(time.RFC3339),
		EndTime:   endTime,
		Duration:  c.Duration,
		Cost:      c.Cost,
		Currency:  c.Currency,
	}
}

func toCallResponses(calls []models.CallRecord) []callResponse {
	out := make([]callResponse, 0, len(calls))
	for _, c := range calls {
		out = append(out, toCallResponse(c))
	}
	return out
}

func (h *CallHandler) GetAll(c *gin.Context) {
	calls, err := h.callSvc.GetAll(c.Request.Context())
	if err != nil {
		response.Internal(c, "Failed to fetch calls")
		return
	}
	response.OK(c, toCallResponses(calls))
}

func (h *CallHandler) GetByExtension(c *gin.Context) {
	ext := c.Param("ext")
	calls, err := h.callSvc.GetByExtension(c.Request.Context(), ext)
	if err != nil {
		response.Internal(c, "Failed to fetch calls")
		return
	}
	response.OK(c, toCallResponses(calls))
}

// DeleteByExtension → DELETE /calls/:ext : clears a user's call history
// (the "clear recents" action). Removes every row owned by the extension.
func (h *CallHandler) DeleteByExtension(c *gin.Context) {
	ext := c.Param("ext")
	deleted, err := h.callSvc.DeleteByExtension(c.Request.Context(), ext)
	if err != nil {
		response.Internal(c, "Failed to clear call history")
		return
	}
	response.OK(c, gin.H{"deleted": deleted})
}

// Stats → GET /stats?days=N : aggregate call metrics for the admin dashboard
// (totals, connection/abandoned rates, direction split, status breakdown, and a
// per-day series). Defaults to the last 7 days; clamped to 1..365.
func (h *CallHandler) Stats(c *gin.Context) {
	days := 7
	if v := c.Query("days"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			days = n
		}
	}
	stats, err := h.callSvc.Stats(c.Request.Context(), days)
	if err != nil {
		response.Internal(c, "Failed to compute stats")
		return
	}
	response.OK(c, stats)
}
