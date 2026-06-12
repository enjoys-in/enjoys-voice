package handler

import (
	"github.com/enjoys-in/enjoys-voice/api/internal/response"
	"github.com/enjoys-in/enjoys-voice/api/internal/service"
	"github.com/gin-gonic/gin"
)

type AuthHandler struct {
	authSvc service.AuthService
}

func NewAuthHandler(as service.AuthService) *AuthHandler {
	return &AuthHandler{authSvc: as}
}

type loginRequest struct {
	Username string `json:"username" binding:"required"`
	Password string `json:"password" binding:"required"`
}

type signupRequest struct {
	Name     string `json:"name" binding:"required"`
	Mobile   string `json:"mobile" binding:"required"`
	Password string `json:"password" binding:"required,min=4"`
}

func (h *AuthHandler) Login(c *gin.Context) {
	var req loginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "Missing credentials")
		return
	}

	user, err := h.authSvc.Login(c.Request.Context(), req.Username, req.Password)
	if err != nil {
		response.Unauthorized(c, "Invalid credentials")
		return
	}

	response.Success(c, "Login successful", gin.H{
		"extension": user.Extension,
		"name":      user.Name,
		"username":  user.Username,
		"mobile":    user.Mobile,
	})
}

func (h *AuthHandler) Signup(c *gin.Context) {
	var req signupRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "Missing fields: name, mobile, password required")
		return
	}

	user, err := h.authSvc.Signup(c.Request.Context(), req.Name, req.Mobile, req.Password)
	if err != nil {
		response.Conflict(c, err.Error())
		return
	}

	response.Created(c, "Account created", gin.H{
		"extension": user.Extension,
		"name":      user.Name,
		"username":  user.Username,
		"mobile":    user.Mobile,
	})
}
