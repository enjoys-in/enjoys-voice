package handler

import (
	"github.com/enjoys-in/enjoys-voice/api/internal/response"
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
		response.Internal(c, "Failed to fetch users")
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
	response.OK(c, result)
}

func (h *UserHandler) GetByExtension(c *gin.Context) {
	ext := c.Param("ext")
	user, err := h.userSvc.GetByExtension(c.Request.Context(), ext)
	if err != nil {
		response.NotFound(c, "Not found")
		return
	}

	response.OK(c, gin.H{
		"extension": user.Extension,
		"name":      user.Name,
		"username":  user.Username,
		"mobile":    user.Mobile,
	})
}

// Lookup → GET /lookup/:phone : resolves a phone/mobile to a user.
func (h *UserHandler) Lookup(c *gin.Context) {
	phone := c.Param("phone")
	user, err := h.userSvc.LookupByPhone(c.Request.Context(), phone)
	if err != nil {
		response.NotFound(c, "No user found for that number")
		return
	}
	response.OK(c, gin.H{
		"extension": user.Extension,
		"name":      user.Name,
		"mobile":    user.Mobile,
	})
}

func (h *UserHandler) Delete(c *gin.Context) {
	ext := c.Param("ext")
	if err := h.userSvc.Delete(c.Request.Context(), ext); err != nil {
		response.Internal(c, "Failed to delete user")
		return
	}
	response.Success(c, "User deleted", nil)
}
