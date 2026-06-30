package service

import (
	"context"
	"crypto/subtle"
	"errors"
	"strings"
	"time"

	"github.com/enjoys-in/enjoys-voice/api/internal/models"
	"github.com/enjoys-in/enjoys-voice/api/internal/repository"
	"gorm.io/gorm"
)

var (
	ErrEdgeDeviceNotFound = errors.New("edge device not found")
	ErrEdgeDeviceInvalid  = errors.New("invalid edge device request")
	ErrEdgeUnauthorized   = errors.New("edge device authentication failed")
)

// EdgeDeviceInput is a partial create/update of an edge device (admin). Only
// non-nil fields are applied so the dashboard can PATCH individual fields.
type EdgeDeviceInput struct {
	DeviceID      *string   `json:"device_id"`
	Name          *string   `json:"name"`
	Extensions    *[]string `json:"extensions"`
	TrunkUsername *string   `json:"trunk_username"`
	TrunkPassword *string   `json:"trunk_password"`
	TrunkRealm    *string   `json:"trunk_realm"`
	TrunkProxy    *string   `json:"trunk_proxy"`
	TrunkRegister *bool     `json:"trunk_register"`
	Active        *bool     `json:"active"`
	RotateToken   *bool     `json:"rotate_token"`
}

type EdgeService interface {
	// Admin provisioning.
	ListDevices(ctx context.Context) ([]models.EdgeDeviceResponse, error)
	CreateDevice(ctx context.Context, input *EdgeDeviceInput) (*models.EdgeDeviceResponse, error)
	GetDevice(ctx context.Context, id uint) (*models.EdgeDeviceResponse, error)
	UpdateDevice(ctx context.Context, id uint, input *EdgeDeviceInput) (*models.EdgeDeviceResponse, error)
	DeleteDevice(ctx context.Context, id uint) error

	// Device sync surface (authenticated by per-device token).
	Authenticate(ctx context.Context, deviceID, token string) (*models.EdgeDevice, error)
	TouchSeen(ctx context.Context, deviceID string)
	Extensions(ctx context.Context, deviceID string) ([]models.EdgeExtensionDTO, error)
	Trunk(ctx context.Context, deviceID string) (*models.EdgeTrunkDTO, error)
	IngestCDRs(ctx context.Context, deviceID string, rows []models.EdgeCDR) error
}

type edgeService struct {
	repo repository.EdgeRepository
}

func NewEdgeService(repo repository.EdgeRepository) EdgeService {
	return &edgeService{repo: repo}
}

func (s *edgeService) ListDevices(ctx context.Context) ([]models.EdgeDeviceResponse, error) {
	devices, err := s.repo.ListDevices(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]models.EdgeDeviceResponse, 0, len(devices))
	for i := range devices {
		out = append(out, devices[i].ToResponse())
	}
	return out, nil
}

func (s *edgeService) CreateDevice(ctx context.Context, input *EdgeDeviceInput) (*models.EdgeDeviceResponse, error) {
	d := &models.EdgeDevice{Active: true, TrunkRegister: true}
	applyEdgeInput(d, input)
	d.DeviceID = strings.TrimSpace(d.DeviceID)
	if d.DeviceID == "" {
		return nil, ErrEdgeDeviceInvalid
	}
	// High-entropy random token stored as a plain SHA-256 hash (fast verify, no
	// brute-force risk on 192 random bits) — same scheme as developer API keys.
	token := "ek_live_" + randomToken(24)
	d.TokenHash = sha256Hex(token)
	if err := s.repo.CreateDevice(ctx, d); err != nil {
		return nil, err
	}
	resp := d.ToResponse()
	resp.Token = token // shown exactly once
	return &resp, nil
}

func (s *edgeService) GetDevice(ctx context.Context, id uint) (*models.EdgeDeviceResponse, error) {
	d, err := s.deviceByID(ctx, id)
	if err != nil {
		return nil, err
	}
	resp := d.ToResponse()
	return &resp, nil
}

func (s *edgeService) UpdateDevice(ctx context.Context, id uint, input *EdgeDeviceInput) (*models.EdgeDeviceResponse, error) {
	d, err := s.deviceByID(ctx, id)
	if err != nil {
		return nil, err
	}
	applyEdgeInput(d, input)
	if strings.TrimSpace(d.DeviceID) == "" {
		return nil, ErrEdgeDeviceInvalid
	}
	var rotated string
	if input != nil && input.RotateToken != nil && *input.RotateToken {
		rotated = "ek_live_" + randomToken(24)
		d.TokenHash = sha256Hex(rotated)
	}
	if err := s.repo.UpdateDevice(ctx, d); err != nil {
		return nil, err
	}
	resp := d.ToResponse()
	resp.Token = rotated // empty unless a rotation was requested
	return &resp, nil
}

func (s *edgeService) DeleteDevice(ctx context.Context, id uint) error {
	if _, err := s.deviceByID(ctx, id); err != nil {
		return err
	}
	return s.repo.DeleteDevice(ctx, id)
}

func (s *edgeService) Authenticate(ctx context.Context, deviceID, token string) (*models.EdgeDevice, error) {
	deviceID = strings.TrimSpace(deviceID)
	token = strings.TrimSpace(token)
	if deviceID == "" || token == "" {
		return nil, ErrEdgeUnauthorized
	}
	d, err := s.repo.GetDeviceByDeviceID(ctx, deviceID)
	if err != nil || !d.Active {
		return nil, ErrEdgeUnauthorized
	}
	want := sha256Hex(token)
	if subtle.ConstantTimeCompare([]byte(want), []byte(d.TokenHash)) != 1 {
		return nil, ErrEdgeUnauthorized
	}
	return d, nil
}

func (s *edgeService) TouchSeen(ctx context.Context, deviceID string) {
	_ = s.repo.TouchDevice(ctx, deviceID, time.Now().UTC())
}

func (s *edgeService) Extensions(ctx context.Context, deviceID string) ([]models.EdgeExtensionDTO, error) {
	d, err := s.repo.GetDeviceByDeviceID(ctx, deviceID)
	if err != nil {
		return nil, ErrEdgeDeviceNotFound
	}
	exts := splitCSVList(d.Extensions)
	if len(exts) == 0 {
		return []models.EdgeExtensionDTO{}, nil
	}
	users, err := s.repo.UsersByExtensions(ctx, exts)
	if err != nil {
		return nil, err
	}
	nameByExt := make(map[string]string, len(users))
	for i := range users {
		nameByExt[users[i].Extension] = users[i].Name
	}
	out := make([]models.EdgeExtensionDTO, 0, len(exts))
	for _, ext := range exts {
		out = append(out, models.EdgeExtensionDTO{
			Extension:      ext,
			Name:           nameByExt[ext],
			CallerIDNumber: ext,
		})
	}
	return out, nil
}

func (s *edgeService) Trunk(ctx context.Context, deviceID string) (*models.EdgeTrunkDTO, error) {
	d, err := s.repo.GetDeviceByDeviceID(ctx, deviceID)
	if err != nil {
		return nil, ErrEdgeDeviceNotFound
	}
	if strings.TrimSpace(d.TrunkProxy) == "" && strings.TrimSpace(d.TrunkUsername) == "" {
		return nil, nil // not configured -> handler returns 404
	}
	return &models.EdgeTrunkDTO{
		Username: d.TrunkUsername,
		Password: d.TrunkPassword,
		Realm:    d.TrunkRealm,
		Proxy:    d.TrunkProxy,
		Register: d.TrunkRegister,
	}, nil
}

func (s *edgeService) IngestCDRs(ctx context.Context, deviceID string, rows []models.EdgeCDR) error {
	now := time.Now().UTC()
	for i := range rows {
		rows[i].ID = 0 // never trust a client-supplied id
		rows[i].DeviceID = deviceID
		rows[i].ReceivedAt = now
	}
	return s.repo.InsertCDRs(ctx, rows)
}

func (s *edgeService) deviceByID(ctx context.Context, id uint) (*models.EdgeDevice, error) {
	d, err := s.repo.GetDevice(ctx, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrEdgeDeviceNotFound
		}
		return nil, err
	}
	return d, nil
}

func applyEdgeInput(d *models.EdgeDevice, in *EdgeDeviceInput) {
	if in == nil {
		return
	}
	if in.DeviceID != nil {
		d.DeviceID = strings.TrimSpace(*in.DeviceID)
	}
	if in.Name != nil {
		d.Name = *in.Name
	}
	if in.Extensions != nil {
		d.Extensions = joinCSV(*in.Extensions)
	}
	if in.TrunkUsername != nil {
		d.TrunkUsername = *in.TrunkUsername
	}
	if in.TrunkPassword != nil {
		d.TrunkPassword = *in.TrunkPassword
	}
	if in.TrunkRealm != nil {
		d.TrunkRealm = *in.TrunkRealm
	}
	if in.TrunkProxy != nil {
		d.TrunkProxy = *in.TrunkProxy
	}
	if in.TrunkRegister != nil {
		d.TrunkRegister = *in.TrunkRegister
	}
	if in.Active != nil {
		d.Active = *in.Active
	}
}

// splitCSVList trims each entry of a comma-separated string, dropping empties.
func splitCSVList(raw string) []string {
	out := []string{}
	for _, p := range strings.Split(raw, ",") {
		if v := strings.TrimSpace(p); v != "" {
			out = append(out, v)
		}
	}
	return out
}
