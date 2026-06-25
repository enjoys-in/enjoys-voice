// Brain factory: turn a resolved per-user agent config into a live AiBrain.
//
// Built once PER CALL by the agent-aware media handlers, so each call gets its
// own Responder (with isolated conversation history) and Synthesizer. The
// registry injects the server-side provider keys.

import type { AiBrain } from "./brain";
import { createResponder, createSynthesizer, createTranscriber } from "./registry";
import type { AgentRuntimeConfig } from "./providers/types";

/** Compose a full speech→LLM→speech brain from one agent's configuration. */
export function buildBrainFromAgent(cfg: AgentRuntimeConfig): AiBrain {
  return {
    createTranscriber: () => createTranscriber(cfg.stt.provider, cfg.language),
    responder: createResponder(cfg.llm),
    synthesizer: createSynthesizer(cfg.tts.provider, cfg.tts.voice, cfg.language),
    greeting: cfg.greeting || undefined,
  };
}
