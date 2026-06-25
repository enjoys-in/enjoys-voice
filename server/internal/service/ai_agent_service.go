package service

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/enjoys-in/enjoys-voice/api/internal/models"
	"github.com/enjoys-in/enjoys-voice/api/internal/repository"
	"gorm.io/gorm"
)

// ErrAiAgentNotFound is returned when an agent id doesn't exist (404).
var ErrAiAgentNotFound = errors.New("ai agent not found")

// ErrAiAgentInvalid is returned when the agent fails validation (400).
var ErrAiAgentInvalid = errors.New("invalid ai agent: a name and valid stt/llm/tts providers are required")

// AiAgentInput is a partial create/update of an AI agent. Only non-nil fields
// are applied.
type AiAgentInput struct {
	Name         *string  `json:"name"`
	Greeting     *string  `json:"greeting"`
	Language     *string  `json:"language"`
	SttProvider  *string  `json:"sttProvider"`
	LlmProvider  *string  `json:"llmProvider"`
	LlmModel     *string  `json:"llmModel"`
	SystemPrompt *string  `json:"systemPrompt"`
	Temperature  *float64 `json:"temperature"`
	TtsProvider  *string  `json:"ttsProvider"`
	TtsVoice     *string  `json:"ttsVoice"`
	Enabled      *bool    `json:"enabled"`
}

// AiAgentView is the API view of an AI agent. It mirrors the stored row 1:1 —
// there are no secrets to redact (provider API keys live server-side in env).
type AiAgentView struct {
	ID             uint      `json:"id"`
	OwnerExtension string    `json:"ownerExtension"`
	Name           string    `json:"name"`
	Greeting       string    `json:"greeting"`
	Language       string    `json:"language"`
	SttProvider    string    `json:"sttProvider"`
	LlmProvider    string    `json:"llmProvider"`
	LlmModel       string    `json:"llmModel"`
	SystemPrompt   string    `json:"systemPrompt"`
	Temperature    float64   `json:"temperature"`
	TtsProvider    string    `json:"ttsProvider"`
	TtsVoice       string    `json:"ttsVoice"`
	Enabled        bool      `json:"enabled"`
	CreatedAt      time.Time `json:"createdAt"`
	UpdatedAt      time.Time `json:"updatedAt"`
}

// AiAgentService owns CRUD over users' per-user AI voice agents.
type AiAgentService interface {
	ListByOwner(ctx context.Context, owner string) ([]AiAgentView, error)
	Get(ctx context.Context, id uint) (*AiAgentView, error)
	Create(ctx context.Context, owner string, input *AiAgentInput) (*AiAgentView, error)
	Update(ctx context.Context, id uint, input *AiAgentInput) (*AiAgentView, error)
	Delete(ctx context.Context, id uint) error
}

type aiAgentService struct {
	repo repository.AiAgentRepository
}

func NewAiAgentService(repo repository.AiAgentRepository) AiAgentService {
	return &aiAgentService{repo: repo}
}

func (s *aiAgentService) ListByOwner(ctx context.Context, owner string) ([]AiAgentView, error) {
	agents, err := s.repo.ListByOwner(ctx, owner)
	if err != nil {
		return nil, err
	}
	out := make([]AiAgentView, 0, len(agents))
	for i := range agents {
		out = append(out, toAiAgentView(&agents[i]))
	}
	return out, nil
}

func (s *aiAgentService) Get(ctx context.Context, id uint) (*AiAgentView, error) {
	agent, err := s.repo.Get(ctx, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrAiAgentNotFound
		}
		return nil, err
	}
	v := toAiAgentView(agent)
	return &v, nil
}

func (s *aiAgentService) Create(ctx context.Context, owner string, input *AiAgentInput) (*AiAgentView, error) {
	// New agents default to enabled with sensible provider defaults so a user can
	// create one with just a name and start iterating on the prompt.
	agent := &models.AiAgent{
		OwnerExtension: owner,
		Enabled:        true,
		Language:       "en",
		SttProvider:    "speechmatics",
		LlmProvider:    "openai",
		LlmModel:       "gpt-4o-mini",
		Temperature:    0.7,
		TtsProvider:    "deepgram",
	}
	applyAiAgentInput(agent, input)
	if err := validateAiAgent(agent); err != nil {
		return nil, err
	}
	if err := s.repo.Create(ctx, agent); err != nil {
		return nil, err
	}
	v := toAiAgentView(agent)
	return &v, nil
}

func (s *aiAgentService) Update(ctx context.Context, id uint, input *AiAgentInput) (*AiAgentView, error) {
	agent, err := s.repo.Get(ctx, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrAiAgentNotFound
		}
		return nil, err
	}
	applyAiAgentInput(agent, input)
	if err := validateAiAgent(agent); err != nil {
		return nil, err
	}
	if err := s.repo.Update(ctx, agent); err != nil {
		return nil, err
	}
	v := toAiAgentView(agent)
	return &v, nil
}

func (s *aiAgentService) Delete(ctx context.Context, id uint) error {
	if _, err := s.repo.Get(ctx, id); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrAiAgentNotFound
		}
		return err
	}
	return s.repo.Delete(ctx, id)
}

// applyAiAgentInput copies non-nil, trimmed input fields onto the agent,
// lowercasing the provider selectors so validation is case-insensitive.
func applyAiAgentInput(a *models.AiAgent, input *AiAgentInput) {
	if input.Name != nil {
		a.Name = strings.TrimSpace(*input.Name)
	}
	if input.Greeting != nil {
		a.Greeting = strings.TrimSpace(*input.Greeting)
	}
	if input.Language != nil {
		if lang := strings.TrimSpace(*input.Language); lang != "" {
			a.Language = lang
		}
	}
	if input.SttProvider != nil {
		a.SttProvider = strings.ToLower(strings.TrimSpace(*input.SttProvider))
	}
	if input.LlmProvider != nil {
		a.LlmProvider = strings.ToLower(strings.TrimSpace(*input.LlmProvider))
	}
	if input.LlmModel != nil {
		a.LlmModel = strings.TrimSpace(*input.LlmModel)
	}
	if input.SystemPrompt != nil {
		a.SystemPrompt = strings.TrimSpace(*input.SystemPrompt)
	}
	if input.Temperature != nil {
		a.Temperature = *input.Temperature
	}
	if input.TtsProvider != nil {
		a.TtsProvider = strings.ToLower(strings.TrimSpace(*input.TtsProvider))
	}
	if input.TtsVoice != nil {
		a.TtsVoice = strings.TrimSpace(*input.TtsVoice)
	}
	if input.Enabled != nil {
		a.Enabled = *input.Enabled
	}
}

// validateAiAgent checks the agent has a name and that each selected provider is
// one the runtime registry actually supports, and clamps the temperature.
func validateAiAgent(a *models.AiAgent) error {
	if a.Name == "" {
		return ErrAiAgentInvalid
	}
	if !contains(models.AiAgentSttProviders, a.SttProvider) ||
		!contains(models.AiAgentLlmProviders, a.LlmProvider) ||
		!contains(models.AiAgentTtsProviders, a.TtsProvider) {
		return ErrAiAgentInvalid
	}
	if a.LlmModel == "" {
		return ErrAiAgentInvalid
	}
	if a.Temperature < 0 {
		a.Temperature = 0
	}
	if a.Temperature > 2 {
		a.Temperature = 2
	}
	return nil
}

// contains reports whether want is in set.
func contains(set []string, want string) bool {
	for _, v := range set {
		if v == want {
			return true
		}
	}
	return false
}

func toAiAgentView(a *models.AiAgent) AiAgentView {
	return AiAgentView{
		ID:             a.ID,
		OwnerExtension: a.OwnerExtension,
		Name:           a.Name,
		Greeting:       a.Greeting,
		Language:       a.Language,
		SttProvider:    a.SttProvider,
		LlmProvider:    a.LlmProvider,
		LlmModel:       a.LlmModel,
		SystemPrompt:   a.SystemPrompt,
		Temperature:    a.Temperature,
		TtsProvider:    a.TtsProvider,
		TtsVoice:       a.TtsVoice,
		Enabled:        a.Enabled,
		CreatedAt:      a.CreatedAt,
		UpdatedAt:      a.UpdatedAt,
	}
}
