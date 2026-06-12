// Package response provides a single, consistent JSON envelope for every HTTP
// handler: { success, message, data }.
//
//	success — true for 2xx outcomes, false for errors
//	message — short human-readable status ("OK", "Created", or an error reason)
//	data    — the payload (object, array, or null on errors)
package response

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// Body is the wire shape returned by every endpoint.
type Body struct {
	Success bool        `json:"success"`
	Message string      `json:"message"`
	Data    interface{} `json:"data"`
}

// write emits the envelope with the given status code.
func write(c *gin.Context, status int, success bool, message string, data interface{}) {
	c.JSON(status, Body{Success: success, Message: message, Data: data})
}

// OK → 200 with data and a generic message.
func OK(c *gin.Context, data interface{}) {
	write(c, http.StatusOK, true, "OK", data)
}

// Success → 200 with a custom message and data.
func Success(c *gin.Context, message string, data interface{}) {
	write(c, http.StatusOK, true, message, data)
}

// Created → 201 with a custom message and data.
func Created(c *gin.Context, message string, data interface{}) {
	write(c, http.StatusCreated, true, message, data)
}

// Error → arbitrary status with success=false and a nil payload.
func Error(c *gin.Context, status int, message string) {
	write(c, status, false, message, nil)
}

// BadRequest → 400.
func BadRequest(c *gin.Context, message string) {
	Error(c, http.StatusBadRequest, message)
}

// Unauthorized → 401.
func Unauthorized(c *gin.Context, message string) {
	Error(c, http.StatusUnauthorized, message)
}

// NotFound → 404.
func NotFound(c *gin.Context, message string) {
	Error(c, http.StatusNotFound, message)
}

// Conflict → 409.
func Conflict(c *gin.Context, message string) {
	Error(c, http.StatusConflict, message)
}

// Internal → 500.
func Internal(c *gin.Context, message string) {
	Error(c, http.StatusInternalServerError, message)
}
