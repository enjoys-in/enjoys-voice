package handler

import (
	"errors"
	"net/http"
	"strings"

	"github.com/enjoys-in/enjoys-voice/api/internal/config"
	"github.com/enjoys-in/enjoys-voice/api/internal/models"
	"github.com/enjoys-in/enjoys-voice/api/internal/response"
	"github.com/enjoys-in/enjoys-voice/api/internal/service"
	"github.com/enjoys-in/enjoys-voice/api/internal/token"
	"github.com/gin-gonic/gin"
)

type AuthHandler struct {
	authSvc service.AuthService
	otpSvc  service.OTPService
	tokens  *token.Manager
	sip     config.SipConfig
	cookie  config.CookieConfig
}

func NewAuthHandler(as service.AuthService, os service.OTPService, tm *token.Manager, sip config.SipConfig, cookie config.CookieConfig) *AuthHandler {
	return &AuthHandler{authSvc: as, otpSvc: os, tokens: tm, sip: sip, cookie: cookie}
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

// otpRequest asks for a one-time code to be sent to a mobile. Purpose selects
// the flow: "signup" (number must be new) or "login" (number must have an
// account); it defaults to "signup".
type otpRequest struct {
	Mobile  string `json:"mobile" binding:"required"`
	Purpose string `json:"purpose"`
}

// signupVerifyRequest completes OTP-verified signup: the same fields as a
// password signup plus the code from the SMS.
type signupVerifyRequest struct {
	Name     string `json:"name" binding:"required"`
	Mobile   string `json:"mobile" binding:"required"`
	Password string `json:"password" binding:"required,min=4"`
	Code     string `json:"code" binding:"required"`
}

// loginOTPRequest is a passwordless login: mobile + the code from the SMS.
type loginOTPRequest struct {
	Mobile string `json:"mobile" binding:"required"`
	Code   string `json:"code" binding:"required"`
}

type refreshRequest struct {
	// Optional: the refresh token may instead arrive in the httpOnly
	// refresh_token cookie (cookie-based clients send no body).
	RefreshToken string `json:"refreshToken"`
}

type updateMeRequest struct {
	Name string `json:"name" binding:"required"`
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

	pair, err := h.tokens.Generate(user.ID, user.Extension)
	if err != nil {
		response.Internal(c, "Failed to issue token")
		return
	}

	h.setAuthCookies(c, pair)
	response.Success(c, "Login successful", h.authPayload(user, pair))
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

	pair, err := h.tokens.Generate(user.ID, user.Extension)
	if err != nil {
		response.Internal(c, "Failed to issue token")
		return
	}

	h.setAuthCookies(c, pair)
	response.Created(c, "Account created", h.authPayload(user, pair))
}

// RequestOTP sends a one-time verification code over SMS. For signup the number
// must be new (else 409); for login the response is always generic so it can't
// be used to probe which numbers have accounts.
func (h *AuthHandler) RequestOTP(c *gin.Context) {
	var req otpRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "Mobile is required")
		return
	}

	var err error
	if req.Purpose == "login" {
		err = h.otpSvc.RequestLoginOTP(c.Request.Context(), req.Mobile)
	} else {
		err = h.otpSvc.RequestSignupOTP(c.Request.Context(), req.Mobile)
	}
	if err != nil {
		h.mapOTPError(c, err)
		return
	}

	response.Success(c, "If the number is eligible, a verification code has been sent", nil)
}

// SignupVerify completes OTP-verified signup, creating the account and issuing
// tokens on success (mirrors Signup once the code checks out).
func (h *AuthHandler) SignupVerify(c *gin.Context) {
	var req signupVerifyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "Missing fields: name, mobile, password, code required")
		return
	}

	user, err := h.otpSvc.VerifySignupOTP(c.Request.Context(), req.Name, req.Mobile, req.Password, req.Code)
	if err != nil {
		h.mapOTPError(c, err)
		return
	}

	pair, err := h.tokens.Generate(user.ID, user.Extension)
	if err != nil {
		response.Internal(c, "Failed to issue token")
		return
	}

	h.setAuthCookies(c, pair)
	response.Created(c, "Account created", h.authPayload(user, pair))
}

// LoginOTP completes passwordless mobile+OTP login, issuing tokens on a valid
// code (mirrors Login but with no password).
func (h *AuthHandler) LoginOTP(c *gin.Context) {
	var req loginOTPRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "Mobile and code are required")
		return
	}

	user, err := h.otpSvc.VerifyLoginOTP(c.Request.Context(), req.Mobile, req.Code)
	if err != nil {
		h.mapOTPError(c, err)
		return
	}

	pair, err := h.tokens.Generate(user.ID, user.Extension)
	if err != nil {
		response.Internal(c, "Failed to issue token")
		return
	}

	h.setAuthCookies(c, pair)
	response.Success(c, "Login successful", h.authPayload(user, pair))
}

// mapOTPError translates OTP service sentinels to HTTP statuses.
func (h *AuthHandler) mapOTPError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, service.ErrOTPUnavailable):
		response.Error(c, http.StatusServiceUnavailable, "OTP delivery is not available")
	case errors.Is(err, service.ErrOTPCooldown):
		response.Error(c, http.StatusTooManyRequests, "Please wait before requesting another code")
	case errors.Is(err, service.ErrMobileRegistered):
		response.Conflict(c, "This number is already registered. Please log in instead")
	case errors.Is(err, service.ErrOTPInvalid):
		response.BadRequest(c, "Invalid or expired code")
	default:
		response.Internal(c, "Could not complete the request")
	}
}

// token is taken from the JSON body when present, otherwise from the httpOnly
// refresh_token cookie — so a cookie-only browser client can refresh without
// ever handling the token in JS.
func (h *AuthHandler) Refresh(c *gin.Context) {
	var req refreshRequest
	_ = c.ShouldBindJSON(&req) // body is optional; the cookie is the fallback

	raw := req.RefreshToken
	if raw == "" {
		if cookie, err := c.Cookie("refresh_token"); err == nil {
			raw = cookie
		}
	}
	if raw == "" {
		response.BadRequest(c, "Missing refresh token")
		return
	}

	claims, err := h.tokens.ParseRefresh(raw)
	if err != nil {
		response.Unauthorized(c, "Invalid refresh token")
		return
	}

	pair, err := h.tokens.Generate(claims.UserID, claims.Extension)
	if err != nil {
		response.Internal(c, "Failed to issue token")
		return
	}

	h.setAuthCookies(c, pair)
	response.Success(c, "Token refreshed", gin.H{
		"token":        pair.AccessToken,
		"refreshToken": pair.RefreshToken,
		"expiresIn":    pair.ExpiresIn,
	})
}

// Me returns the currently authenticated user, identified by the access-token
// subject that AuthMiddleware put on the context. The UI calls this on boot to
// validate a persisted session (a stored `isAuthenticated` flag only means the
// user *was* logged in) and to refresh the cached profile.
func (h *AuthHandler) Me(c *gin.Context) {
	ext, _ := c.Get("extension")
	extStr, _ := ext.(string)
	if extStr == "" {
		response.Unauthorized(c, "Not authenticated")
		return
	}

	user, err := h.authSvc.GetByExtension(c.Request.Context(), extStr)
	if err != nil {
		response.Unauthorized(c, "Session no longer valid")
		return
	}

	// sipConfig is included so a client that bootstraps its session from the
	// httpOnly cookie (no login response in hand) can still reconstruct the SIP
	// connection details without persisting them in localStorage.
	response.OK(c, gin.H{
		"extension": user.Extension,
		"name":      user.Name,
		"username":  user.Username,
		"mobile":    user.Mobile,
		"sipConfig": gin.H{
			"wsUrl":        h.sip.WsURL(),
			"sipWsUrl":     h.sip.SipWsURL(),
			"domain":       h.sip.Domain,
			"trunkEnabled": h.sip.TrunkEnabled,
		},
	})
}

// UpdateMe lets the authenticated user change their own display name. The
// target is always the access-token subject set by AuthMiddleware, so there's
// no IDOR surface — a user can only rename themselves. Backs the profile
// "edit name" action in the UI.
func (h *AuthHandler) UpdateMe(c *gin.Context) {
	ext, _ := c.Get("extension")
	extStr, _ := ext.(string)
	if extStr == "" {
		response.Unauthorized(c, "Not authenticated")
		return
	}

	var req updateMeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "Name is required")
		return
	}

	name := strings.TrimSpace(req.Name)
	if name == "" {
		response.BadRequest(c, "Name cannot be empty")
		return
	}

	user, err := h.authSvc.UpdateName(c.Request.Context(), extStr, name)
	if err != nil {
		response.Internal(c, "Failed to update profile")
		return
	}

	response.Success(c, "Profile updated", gin.H{
		"extension": user.Extension,
		"name":      user.Name,
		"username":  user.Username,
		"mobile":    user.Mobile,
	})
}

// Logout clears the auth cookies. Because the token + refresh_token cookies are
// httpOnly, the browser's JS cannot delete them on sign-out — only the server
// can, by re-issuing them with an immediate expiry. It carries no session
// requirement (it only tears state down), so it's mounted as a public route and
// is safe to call even with an already-expired or missing token.
func (h *AuthHandler) Logout(c *gin.Context) {
	h.clearAuthCookies(c)
	response.Success(c, "Logged out", nil)
}

// can authenticate with `credentials: "include"`. The access token also stays
// in the JSON body for the Bearer-header flow; both transports are accepted.
func (h *AuthHandler) setAuthCookies(c *gin.Context, pair *token.Pair) {
	c.SetSameSite(sameSite(h.cookie.SameSite))
	c.SetCookie("token", pair.AccessToken, h.cookie.AccessMaxAge, "/", h.cookie.Domain, h.cookie.Secure, true)
	c.SetCookie("refresh_token", pair.RefreshToken, h.cookie.RefreshMaxAge, "/", h.cookie.Domain, h.cookie.Secure, true)
}

// clearAuthCookies deletes the auth cookies by re-issuing them empty with a
// negative MaxAge, which tells the browser to remove them immediately. The
// path/domain/secure/sameSite attributes must mirror setAuthCookies, otherwise
// the browser treats them as different cookies and leaves the originals intact.
func (h *AuthHandler) clearAuthCookies(c *gin.Context) {
	c.SetSameSite(sameSite(h.cookie.SameSite))
	c.SetCookie("token", "", -1, "/", h.cookie.Domain, h.cookie.Secure, true)
	c.SetCookie("refresh_token", "", -1, "/", h.cookie.Domain, h.cookie.Secure, true)
}

func sameSite(mode string) http.SameSite {
	switch mode {
	case "none", "None":
		return http.SameSiteNoneMode
	case "strict", "Strict":
		return http.SameSiteStrictMode
	default:
		return http.SameSiteLaxMode
	}
}

// authPayload builds the login/signup response: tokens, user and SIP config.
func (h *AuthHandler) authPayload(user *models.User, pair *token.Pair) gin.H {
	return gin.H{
		"token":        pair.AccessToken,
		"refreshToken": pair.RefreshToken,
		"expiresIn":    pair.ExpiresIn,
		"user": gin.H{
			"extension": user.Extension,
			"name":      user.Name,
			"username":  user.Username,
			"mobile":    user.Mobile,
		},
		"sipConfig": gin.H{
			"wsUrl":        h.sip.WsURL(),
			"sipWsUrl":     h.sip.SipWsURL(),
			"domain":       h.sip.Domain,
			"trunkEnabled": h.sip.TrunkEnabled,
		},
	}
}
