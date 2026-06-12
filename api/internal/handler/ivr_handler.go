package handler

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/enjoys-in/enjoys-voice/api/internal/models"
	"github.com/enjoys-in/enjoys-voice/api/internal/response"
	"github.com/enjoys-in/enjoys-voice/api/internal/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type IvrHandler struct {
	ivrSvc service.IvrService
}

func NewIvrHandler(is service.IvrService) *IvrHandler {
	return &IvrHandler{ivrSvc: is}
}

// ivrGraph is the {nodes, edges} payload persisted in the IvrFlow.Graph jsonb column.
type ivrGraph struct {
	Nodes json.RawMessage `json:"nodes"`
	Edges json.RawMessage `json:"edges"`
}

type ivrFlowRequest struct {
	ID        string          `json:"id"`
	Name      string          `json:"name" binding:"required"`
	Extension string          `json:"extension" binding:"required"`
	Enabled   *bool           `json:"enabled"`
	Nodes     json.RawMessage `json:"nodes"`
	Edges     json.RawMessage `json:"edges"`
}

type ivrFlowResponse struct {
	ID        string          `json:"id"`
	Name      string          `json:"name"`
	Extension string          `json:"extension"`
	Enabled   bool            `json:"enabled"`
	Nodes     json.RawMessage `json:"nodes"`
	Edges     json.RawMessage `json:"edges"`
	CreatedAt time.Time       `json:"createdAt"`
	UpdatedAt time.Time       `json:"updatedAt"`
}

type ivrFlowSummary struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Extension string    `json:"extension"`
	Enabled   bool      `json:"enabled"`
	NodeCount int       `json:"nodeCount"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// decodeGraph extracts nodes/edges, defaulting both to empty arrays.
func decodeGraph(g models.JSONB) ivrGraph {
	graph := ivrGraph{}
	if len(g) > 0 {
		_ = json.Unmarshal(g, &graph)
	}
	if len(graph.Nodes) == 0 {
		graph.Nodes = json.RawMessage("[]")
	}
	if len(graph.Edges) == 0 {
		graph.Edges = json.RawMessage("[]")
	}
	return graph
}

func toFlowResponse(f *models.IvrFlow) ivrFlowResponse {
	g := decodeGraph(f.Graph)
	return ivrFlowResponse{
		ID:        f.ID,
		Name:      f.Name,
		Extension: f.Extension,
		Enabled:   f.Enabled,
		Nodes:     g.Nodes,
		Edges:     g.Edges,
		CreatedAt: f.CreatedAt,
		UpdatedAt: f.UpdatedAt,
	}
}

func toFlowSummary(f *models.IvrFlow) ivrFlowSummary {
	g := decodeGraph(f.Graph)
	var nodes []json.RawMessage
	_ = json.Unmarshal(g.Nodes, &nodes)
	return ivrFlowSummary{
		ID:        f.ID,
		Name:      f.Name,
		Extension: f.Extension,
		Enabled:   f.Enabled,
		NodeCount: len(nodes),
		CreatedAt: f.CreatedAt,
		UpdatedAt: f.UpdatedAt,
	}
}

// List → GET /ivr/flows : returns lightweight summaries.
func (h *IvrHandler) List(c *gin.Context) {
	flows, err := h.ivrSvc.List(c.Request.Context())
	if err != nil {
		response.Internal(c, "Failed to fetch IVR flows")
		return
	}
	out := make([]ivrFlowSummary, 0, len(flows))
	for i := range flows {
		out = append(out, toFlowSummary(&flows[i]))
	}
	response.OK(c, out)
}

// Get → GET /ivr/flows/:id : returns a full flow with its node/edge graph.
func (h *IvrHandler) Get(c *gin.Context) {
	id := c.Param("id")
	flow, err := h.ivrSvc.Get(c.Request.Context(), id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			response.NotFound(c, "IVR flow not found")
			return
		}
		response.Internal(c, "Failed to fetch IVR flow")
		return
	}
	response.OK(c, toFlowResponse(flow))
}

// Save → POST /ivr/flows or PUT /ivr/flows/:id : upserts a flow.
func (h *IvrHandler) Save(c *gin.Context) {
	var req ivrFlowRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "name and extension are required")
		return
	}

	// Allow the id to come from the URL (PUT) or the body (POST).
	if id := c.Param("id"); id != "" {
		req.ID = id
	}
	if req.ID == "" {
		req.ID = fmt.Sprintf("ivr_%d", time.Now().UnixNano())
	}

	graph := ivrGraph{Nodes: req.Nodes, Edges: req.Edges}
	if len(graph.Nodes) == 0 {
		graph.Nodes = json.RawMessage("[]")
	}
	if len(graph.Edges) == 0 {
		graph.Edges = json.RawMessage("[]")
	}
	rawGraph, err := json.Marshal(graph)
	if err != nil {
		response.BadRequest(c, "Invalid nodes/edges payload")
		return
	}

	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}

	flow := &models.IvrFlow{
		ID:        req.ID,
		Name:      req.Name,
		Extension: req.Extension,
		Enabled:   enabled,
		Graph:     models.JSONB(rawGraph),
	}

	if err := h.ivrSvc.Save(c.Request.Context(), flow); err != nil {
		response.Error(c, http.StatusConflict, "Failed to save IVR flow: "+err.Error())
		return
	}

	// Reload to surface DB-managed timestamps.
	saved, err := h.ivrSvc.Get(c.Request.Context(), flow.ID)
	if err != nil {
		response.Created(c, "IVR flow saved", toFlowResponse(flow))
		return
	}
	response.Created(c, "IVR flow saved", toFlowResponse(saved))
}

// Delete → DELETE /ivr/flows/:id
func (h *IvrHandler) Delete(c *gin.Context) {
	id := c.Param("id")
	if err := h.ivrSvc.Delete(c.Request.Context(), id); err != nil {
		response.Internal(c, "Failed to delete IVR flow")
		return
	}
	response.Success(c, "IVR flow deleted", gin.H{"id": id})
}
