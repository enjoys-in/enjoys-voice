package models

import "time"

// AiAgent is a per-user, configurable AI voice agent. A user defines how their
// agent behaves — which LLM answers, which voice speaks, the system prompt and
// greeting — and the SIP/media runtime builds a live speech→LLM→speech pipeline
// from this config whenever a call is routed to the agent (offline fallback on
// the owner's DID, an `ai_agent` routing rule, or an IVR "AI Agent" node).
//
// Agents are owner-scoped (self-service) — a user only ever manages the agents
// they own. Provider API keys are NEVER stored here: they live server-side in
// the runtime's environment (OPENAI_API_KEY, GEMINI_API_KEY, SARVAM_API_KEY,
// DEEPGRAM_API_KEY, SPEECHMATICS_API_KEY). An agent only selects which provider
// + model/voice to use, so a leaked agent row never exposes a credential.
type AiAgent struct {
	ID             uint   `gorm:"primaryKey" json:"id"`
	OwnerExtension string `gorm:"index;size:20;not null" json:"ownerExtension"`
	Name           string `gorm:"size:120;not null" json:"name"`

	// Greeting is spoken once when the call connects (blank = no greeting).
	Greeting string `gorm:"type:text" json:"greeting"`
	// Language BCP-47-ish tag passed to STT/TTS (e.g. "en", "hi-IN").
	Language string `gorm:"size:16;not null;default:'en'" json:"language"`

	// ─── Speech-to-text (what the caller said) ───
	SttProvider string `gorm:"size:24;not null;default:'speechmatics'" json:"sttProvider"`

	// ─── LLM (the agent's reply) ───
	LlmProvider  string  `gorm:"size:24;not null;default:'openai'" json:"llmProvider"`
	LlmModel     string  `gorm:"size:80;not null;default:'gpt-4o-mini'" json:"llmModel"`
	SystemPrompt string  `gorm:"type:text" json:"systemPrompt"`
	Temperature  float64 `gorm:"not null;default:0.7" json:"temperature"`

	// ─── Text-to-speech (the agent's voice) ───
	TtsProvider string `gorm:"size:24;not null;default:'deepgram'" json:"ttsProvider"`
	TtsVoice    string `gorm:"size:80" json:"ttsVoice"`

	Enabled   bool      `gorm:"not null;default:true" json:"enabled"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

func (AiAgent) TableName() string { return "ai_agents" }

// Provider option sets. The Go API validates a chosen provider against these so
// the dashboard and the Node runtime registry stay in lock-step.
var (
	// AiAgentSttProviders are the supported speech-to-text engines.
	AiAgentSttProviders = []string{"speechmatics", "deepgram"}
	// AiAgentLlmProviders are the supported LLM engines.
	AiAgentLlmProviders = []string{"openai", "gemini"}
	// AiAgentTtsProviders are the supported text-to-speech engines.
	AiAgentTtsProviders = []string{"sarvam", "deepgram", "speechmatics"}
)
