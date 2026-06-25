// AI provider registry: maps an agent's provider selectors to concrete
// Transcriber / Responder / Synthesizer instances, injecting the server-side API
// keys from streamingConfig. This is the ONE place that knows which classes back
// which provider name, so adding a vendor is a single edit here.
//
// Keys live in the runtime environment (never in the agent row), so a user only
// ever chooses a provider/model/voice — they never see or supply a credential.

import { streamingConfig } from "../config";
import type { Responder, Synthesizer, Transcriber } from "./brain";
import { SpeechmaticsTranscriber } from "./speechmatics.transcriber";
import { DeepgramTranscriber } from "./providers/stt/deepgram.transcriber";
import { OpenAiResponder } from "./providers/llm/openai.responder";
import { GeminiResponder } from "./providers/llm/gemini.responder";
import { DeepgramSynthesizer } from "./providers/tts/deepgram.synthesizer";
import { SarvamSynthesizer } from "./providers/tts/sarvam.synthesizer";
import { SpeechmaticsSynthesizer } from "./providers/tts/speechmatics.synthesizer";
import type {
  AgentRuntimeConfig,
  LlmProvider,
  SttProvider,
  TtsProvider,
} from "./providers/types";

/** Build a fresh streaming Transcriber for one call. */
export function createTranscriber(provider: SttProvider, language: string): Transcriber {
  switch (provider) {
    case "deepgram":
      return new DeepgramTranscriber({ apiKey: streamingConfig.ai.deepgramApiKey, language });
    case "speechmatics":
    default:
      return new SpeechmaticsTranscriber(language);
  }
}

/** Build the LLM Responder for one call (holds its own conversation history). */
export function createResponder(cfg: AgentRuntimeConfig["llm"]): Responder {
  const provider = cfg.provider as LlmProvider;
  switch (provider) {
    case "gemini":
      return new GeminiResponder({
        apiKey: streamingConfig.ai.geminiApiKey,
        model: cfg.model,
        systemPrompt: cfg.systemPrompt,
        temperature: cfg.temperature,
      });
    case "openai":
    default:
      return new OpenAiResponder({
        apiKey: streamingConfig.ai.openaiApiKey,
        model: cfg.model,
        systemPrompt: cfg.systemPrompt,
        temperature: cfg.temperature,
      });
  }
}

/** Build the TTS Synthesizer for one call (returns 8 kHz mu-law). */
export function createSynthesizer(
  provider: TtsProvider,
  voice: string,
  language: string,
): Synthesizer {
  switch (provider) {
    case "sarvam":
      return new SarvamSynthesizer({ apiKey: streamingConfig.ai.sarvamApiKey, voice, language });
    case "speechmatics":
      return new SpeechmaticsSynthesizer({
        apiKey: streamingConfig.ai.speechmaticsApiKey,
        voice,
        language,
      });
    case "deepgram":
    default:
      return new DeepgramSynthesizer({ apiKey: streamingConfig.ai.deepgramApiKey, voice });
  }
}
