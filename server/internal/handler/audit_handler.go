package handler

import (
	"strconv"
	"time"

	"github.com/enjoys-in/enjoys-voice/api/internal/repository"
	"github.com/enjoys-in/enjoys-voice/api/internal/response"
	"github.com/enjoys-in/enjoys-voice/api/internal/service"
	"github.com/gin-gonic/gin"
)

type AuditHandler struct {
	auditSvc service.AuditService
}

func NewAuditHandler(as service.AuditService) *AuditHandler {
	return &AuditHandler{auditSvc: as}
}

// parseTime accepts RFC3339; returns nil for empty/invalid input.
func parseTime(v string) *time.Time {
	if v == "" {
		return nil
	}
	if t, err := time.Parse(time.RFC3339, v); err == nil {
		return &t
	}
	return nil
}

// Query → GET /audit?user=&event=&from=&to=&limit=
func (h *AuditHandler) Query(c *gin.Context) {
	limit, _ := strconv.Atoi(c.Query("limit"))
	q := repository.AuditQuery{
		Extension: c.Query("user"),
		Event:     c.Query("event"),
		From:      parseTime(c.Query("from")),
		To:        parseTime(c.Query("to")),
		Limit:     limit,
	}

	logs, err := h.auditSvc.Query(c.Request.Context(), q)
	if err != nil {
		response.Internal(c, "Failed to fetch audit logs")
		return
	}
	response.OK(c, logs)
}

// GetByExtension → GET /audit/:ext?limit=
func (h *AuditHandler) GetByExtension(c *gin.Context) {
	ext := c.Param("ext")
	limit, _ := strconv.Atoi(c.Query("limit"))

	logs, err := h.auditSvc.GetByExtension(c.Request.Context(), ext, limit)
	if err != nil {
		response.Internal(c, "Failed to fetch audit logs")
		return
	}
	response.OK(c, logs)
}
