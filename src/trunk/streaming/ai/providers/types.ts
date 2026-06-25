// Per-call AI agent runtime configuration + provider option types.
//
// This is the normalized shape the brain factory consumes — decoupled from both
// the Go API's stored row and the Postgres read model, so providers never import
// the database layer. `buildBrainFromAgent` (agent.brain.ts) maps a DB record to
// this and the registry (registry.ts) turns each selector into a concrete
// Transcriber / Responder / Synthesizer.

/** Supported speech-to-text engines. Mirrors models.AiAgentSttProviders (Go). */
export type SttProvider = "speechmatics" | "deepgram";
/** Supported LLM engines. Mirrors models.AiAgentLlmProviders (Go). */
export type LlmProvider = "openai" | "gemini";
/** Supported text-to-speech engines. Mirrors models.AiAgentTtsProviders (Go). */
export type TtsProvider = "sarvam" | "deepgram" | "speechmatics";

/** Fully-resolved config for one agent, ready to build a live pipeline from. */
export interface AgentRuntimeConfig {
  id: number;
  name: string;
  /** Spoken once when the call connects (empty = none). */
  greeting: string;
  /** BCP-47-ish language tag passed to STT/TTS (e.g. "en", "hi-IN"). */
  language: string;
  stt: { provider: SttProvider };
  llm: {
    provider: LlmProvider;
    model: string;
    systemPrompt: string;
    temperature: number;
  };
  tts: { provider: TtsProvider; voice: string };
}
