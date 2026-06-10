package handler

import (
	"net/http"

	"github.com/enjoys-in/enjoys-voice/api/internal/service"
	"github.com/gin-gonic/gin"
)

type BlockHandler struct {
	blockSvc service.BlockService
}

func NewBlockHandler(bs service.BlockService) *BlockHandler {
	return &BlockHandler{blockSvc: bs}
}

func (h *BlockHandler) Get(c *gin.Context) {
	ext := c.Param("ext")
	numbers, err := h.blockSvc.GetByExtension(c.Request.Context(), ext)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch blocked numbers"})
		return
	}
	if numbers == nil {
		numbers = []string{}
	}
	c.JSON(http.StatusOK, gin.H{"blocked": numbers})
}

type blockRequest struct {
	Number string `json:"number" binding:"required"`
}

func (h *BlockHandler) Add(c *gin.Context) {
	ext := c.Param("ext")
	var req blockRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Missing number"})
		return
	}

	if err := h.blockSvc.Add(c.Request.Context(), ext, req.Number); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true})
}

func (h *BlockHandler) Remove(c *gin.Context) {
	ext := c.Param("ext")
	number := c.Param("number")

	if err := h.blockSvc.Remove(c.Request.Context(), ext, number); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true})
}
