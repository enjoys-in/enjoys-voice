package handler

import (
	"net/http"

	"github.com/enjoys-in/enjoys-voice/api/internal/service"
	"github.com/gin-gonic/gin"
)

type UserHandler struct {
	userSvc service.UserService
}

func NewUserHandler(us service.UserService) *UserHandler {
	return &UserHandler{userSvc: us}
}

func (h *UserHandler) GetAll(c *gin.Context) {
	users, err := h.userSvc.GetAll(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch users"})
		return
	}

	result := make([]gin.H, 0, len(users))
	for _, u := range users {
		result = append(result, gin.H{
			"extension": u.Extension,
			"name":      u.Name,
			"username":  u.Username,
			"mobile":    u.Mobile,
		})
	}
	c.JSON(http.StatusOK, result)
}

func (h *UserHandler) GetByExtension(c *gin.Context) {
	ext := c.Param("ext")
	user, err := h.userSvc.GetByExtension(c.Request.Context(), ext)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"extension": user.Extension,
		"name":      user.Name,
		"username":  user.Username,
		"mobile":    user.Mobile,
	})
}

func (h *UserHandler) Delete(c *gin.Context) {
	ext := c.Param("ext")
	if err := h.userSvc.Delete(c.Request.Context(), ext); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete user"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}
