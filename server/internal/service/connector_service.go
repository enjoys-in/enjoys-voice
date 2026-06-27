package service

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/enjoys-in/enjoys-voice/api/internal/models"
	"github.com/enjoys-in/enjoys-voice/api/internal/repository"
	"gorm.io/gorm"
)

// ─── connector types ────────────────────────────────────

// ConnectorTypes is the closed set of supported connector kinds.
var ConnectorTypes = map[string]bool{
	"email":   true,
	"webhook": true,
}

// connectorSecretFields lists the config keys that hold secrets per type. These
// are never serialized back to clients and are preserved across updates when
// left blank.
var connectorSecretFields = map[string][]string{
	"email":   {"password"},
	"webhook": {"secret"},
}

// ErrConnectorNotFound is returned when a connector id doesn't exist (404).
var ErrConnectorNotFound = errors.New("connector not found")

// ErrConnectorInvalid is returned when required fields are missing or the type
// is unsupported (400).
var ErrConnectorInvalid = errors.New("name and a valid type (email|webhook) are required")

// ConnectorInput is a partial create/update of a connector. Only non-nil fields
// are applied; Config (when supplied) is a full replacement of the type-specific
// settings, except secret fields left blank keep their stored value.
type ConnectorInput struct {
	Name    *string         `json:"name"`
	Type    *string         `json:"type"`
	Enabled *bool           `json:"enabled"`
	Config  json.RawMessage `json:"config"`
}

// ConnectorView is the API view of a connector: secrets stripped from Config,
// with HasSecret reporting whether one is stored.
type ConnectorView struct {
	ID             uint            `json:"id"`
	Name           string          `json:"name"`
	Type           string          `json:"type"`
	OwnerExtension string          `json:"ownerExtension,omitempty"`
	Enabled        bool            `json:"enabled"`
	Config         json.RawMessage `json:"config"`
	HasSecret      bool            `json:"has_secret"`
	CreatedAt      time.Time       `json:"createdAt"`
	UpdatedAt      time.Time       `json:"updatedAt"`
}

// ConnectorService owns CRUD over outbound integration connectors.
type ConnectorService interface {
	List(ctx context.Context) ([]ConnectorView, error)
	ListByOwner(ctx context.Context, owner string) ([]ConnectorView, error)
	Get(ctx context.Context, id uint) (*ConnectorView, error)
	Create(ctx context.Context, owner string, input *ConnectorInput) (*ConnectorView, error)
	Update(ctx context.Context, id uint, input *ConnectorInput) (*ConnectorView, error)
	Delete(ctx context.Context, id uint) error
}

type connectorService struct {
	repo repository.ConnectorRepository
}

func NewConnectorService(repo repository.ConnectorRepository) ConnectorService {
	return &connectorService{repo: repo}
}

func (s *connectorService) List(ctx context.Context) ([]ConnectorView, error) {
	conns, err := s.repo.List(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]ConnectorView, 0, len(conns))
	for i := range conns {
		out = append(out, toConnectorView(&conns[i]))
	}
	return out, nil
}

func (s *connectorService) ListByOwner(ctx context.Context, owner string) ([]ConnectorView, error) {
	conns, err := s.repo.ListByOwner(ctx, owner)
	if err != nil {
		return nil, err
	}
	out := make([]ConnectorView, 0, len(conns))
	for i := range conns {
		out = append(out, toConnectorView(&conns[i]))
	}
	return out, nil
}

func (s *connectorService) Get(ctx context.Context, id uint) (*ConnectorView, error) {
	conn, err := s.repo.Get(ctx, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrConnectorNotFound
		}
		return nil, err
	}
	v := toConnectorView(conn)
	return &v, nil
}

func (s *connectorService) Create(ctx context.Context, owner string, input *ConnectorInput) (*ConnectorView, error) {
	conn := &models.Connector{Enabled: true, Config: models.JSONB("{}"), OwnerExtension: owner}
	if input.Name != nil {
		conn.Name = strings.TrimSpace(*input.Name)
	}
	if input.Type != nil {
		conn.Type = strings.ToLower(strings.TrimSpace(*input.Type))
	}
	if input.Enabled != nil {
		conn.Enabled = *input.Enabled
	}
	if conn.Name == "" || !ConnectorTypes[conn.Type] {
		return nil, ErrConnectorInvalid
	}
	if len(input.Config) > 0 {
		conn.Config = models.JSONB(input.Config)
	}
	if err := s.repo.Create(ctx, conn); err != nil {
		return nil, err
	}
	v := toConnectorView(conn)
	return &v, nil
}

func (s *connectorService) Update(ctx context.Context, id uint, input *ConnectorInput) (*ConnectorView, error) {
	conn, err := s.repo.Get(ctx, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrConnectorNotFound
		}
		return nil, err
	}
	if input.Name != nil {
		conn.Name = strings.TrimSpace(*input.Name)
	}
	if input.Type != nil {
		conn.Type = strings.ToLower(strings.TrimSpace(*input.Type))
	}
	if input.Enabled != nil {
		conn.Enabled = *input.Enabled
	}
	if conn.Name == "" || !ConnectorTypes[conn.Type] {
		return nil, ErrConnectorInvalid
	}
	if len(input.Config) > 0 {
		// Preserve blank secret fields so editing without re-entering the
		// password / signing secret keeps the stored one.
		merged, mErr := preserveConnectorSecrets(conn.Type, conn.Config, input.Config)
		if mErr != nil {
			return nil, ErrConnectorInvalid
		}
		conn.Config = models.JSONB(merged)
	}
	if err := s.repo.Update(ctx, conn); err != nil {
		return nil, err
	}
	v := toConnectorView(conn)
	return &v, nil
}

func (s *connectorService) Delete(ctx context.Context, id uint) error {
	if _, err := s.repo.Get(ctx, id); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrConnectorNotFound
		}
		return err
	}
	return s.repo.Delete(ctx, id)
}

// toConnectorView strips secret config fields and reports whether one is set.
func toConnectorView(c *models.Connector) ConnectorView {
	cfg, hasSecret := redactConnectorConfig(c.Type, c.Config)
	return ConnectorView{
		ID:             c.ID,
		Name:           c.Name,
		Type:           c.Type,
		OwnerExtension: c.OwnerExtension,
		Enabled:        c.Enabled,
		Config:         cfg,
		HasSecret:      hasSecret,
		CreatedAt:      c.CreatedAt,
		UpdatedAt:      c.UpdatedAt,
	}
}

// redactConnectorConfig removes the type's secret keys from the config and
// returns the cleaned JSON plus whether a non-empty secret was present.
func redactConnectorConfig(t string, raw models.JSONB) (json.RawMessage, bool) {
	m := map[string]json.RawMessage{}
	if len(raw) > 0 {
		_ = json.Unmarshal(raw, &m)
	}
	hasSecret := false
	for _, key := range connectorSecretFields[t] {
		if v, ok := m[key]; ok {
			var sv string
			if json.Unmarshal(v, &sv) == nil && sv != "" {
				hasSecret = true
			}
			delete(m, key)
		}
	}
	out, err := json.Marshal(m)
	if err != nil {
		return json.RawMessage("{}"), hasSecret
	}
	return out, hasSecret
}

// preserveConnectorSecrets overlays the incoming config but restores any secret
// field that was left blank/missing from the existing stored config.
func preserveConnectorSecrets(t string, existing models.JSONB, incoming json.RawMessage) (json.RawMessage, error) {
	inMap := map[string]json.RawMessage{}
	if len(incoming) > 0 {
		if err := json.Unmarshal(incoming, &inMap); err != nil {
			return nil, err
		}
	}
	exMap := map[string]json.RawMessage{}
	if len(existing) > 0 {
		_ = json.Unmarshal(existing, &exMap)
	}
	for _, key := range connectorSecretFields[t] {
		blank := true
		if v, ok := inMap[key]; ok {
			var sv string
			if json.Unmarshal(v, &sv) != nil || sv != "" {
				blank = false
			}
		}
		if blank {
			if ex, ok := exMap[key]; ok {
				inMap[key] = ex
			} else {
				delete(inMap, key)
			}
		}
	}
	return json.Marshal(inMap)
}
