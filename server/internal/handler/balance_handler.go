package handler

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/enjoys-in/enjoys-voice/api/internal/models"
	"github.com/enjoys-in/enjoys-voice/api/internal/response"
	"github.com/enjoys-in/enjoys-voice/api/internal/service"
	"github.com/gin-gonic/gin"
)

// BalanceHandler exposes the prepaid wallet. Self-reads derive the extension
// from the JWT (never the path), so a user can only ever see their own wallet.
// Mutations (top-ups) and reads of another user's wallet require an admin
// extension — there is no role column in this codebase, so admin identity is an
// allow-list configured via ADMIN_EXTENSIONS. With an empty allow-list every
// admin-only endpoint is denied, which is the safe default (no self-serve credit).
type BalanceHandler struct {
	svc    service.BalanceService
	admins map[string]bool
}

func NewBalanceHandler(svc service.BalanceService, adminExtensions []string) *BalanceHandler {
	admins := make(map[string]bool, len(adminExtensions))
	for _, ext := range adminExtensions {
		if ext != "" {
			admins[ext] = true
		}
	}
	return &BalanceHandler{svc: svc, admins: admins}
}

type topUpRequest struct {
	Amount float64 `json:"amount"`
	Reason string  `json:"reason"`
}

// GetSelf → GET /balance — the caller's own wallet (extension from JWT).
func (h *BalanceHandler) GetSelf(c *gin.Context) {
	ext := c.GetString("extension")
	if ext == "" {
		response.Unauthorized(c, "Missing extension")
		return
	}
	h.respondBalance(c, ext)
}

// TxnsSelf → GET /balance/txns — the caller's own ledger (extension from JWT).
func (h *BalanceHandler) TxnsSelf(c *gin.Context) {
	ext := c.GetString("extension")
	if ext == "" {
		response.Unauthorized(c, "Missing extension")
		return
	}
	h.respondTxns(c, ext)
}

// GetByExt → GET /balance/:ext — admin read of any wallet.
func (h *BalanceHandler) GetByExt(c *gin.Context) {
	if !h.requireAdmin(c) {
		return
	}
	h.respondBalance(c, c.Param("ext"))
}

// TxnsByExt → GET /balance/:ext/txns — admin read of any ledger.
func (h *BalanceHandler) TxnsByExt(c *gin.Context) {
	if !h.requireAdmin(c) {
		return
	}
	h.respondTxns(c, c.Param("ext"))
}

// TopUp → POST /balance/:ext/topup — admin credits a wallet.
func (h *BalanceHandler) TopUp(c *gin.Context) {
	if !h.requireAdmin(c) {
		return
	}
	ext := c.Param("ext")
	if ext == "" {
		response.BadRequest(c, "Extension is required")
		return
	}

	var req topUpRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "Invalid request body")
		return
	}

	bal, err := h.svc.TopUp(c.Request.Context(), ext, req.Amount, req.Reason)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrBalanceDisabled):
			response.Error(c, http.StatusServiceUnavailable, err.Error())
		case errors.Is(err, service.ErrBalanceAmount):
			response.BadRequest(c, err.Error())
		default:
			response.Internal(c, err.Error())
		}
		return
	}
	response.Success(c, "Balance topped up", bal.ToResponse(h.svc.Enabled()))
}

func (h *BalanceHandler) respondBalance(c *gin.Context, ext string) {
	bal, err := h.svc.Get(c.Request.Context(), ext)
	if err != nil {
		response.Internal(c, err.Error())
		return
	}
	response.OK(c, bal.ToResponse(h.svc.Enabled()))
}

func (h *BalanceHandler) respondTxns(c *gin.Context, ext string) {
	limit, _ := strconv.Atoi(c.Query("limit"))
	txns, err := h.svc.ListTxns(c.Request.Context(), ext, limit)
	if err != nil {
		response.Internal(c, err.Error())
		return
	}
	out := make([]models.BalanceTxnResponse, 0, len(txns))
	for i := range txns {
		out = append(out, txns[i].ToResponse())
	}
	response.OK(c, out)
}

// requireAdmin allows the request only when the JWT extension is in the
// configured admin allow-list; otherwise it writes 403 and returns false.
func (h *BalanceHandler) requireAdmin(c *gin.Context) bool {
	ext := c.GetString("extension")
	if ext == "" || !h.admins[ext] {
		response.Error(c, http.StatusForbidden, "Admin access required")
		return false
	}
	return true
}
