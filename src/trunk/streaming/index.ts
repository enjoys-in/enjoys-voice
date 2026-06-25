// Media-streaming module barrel.
//
// Deliberately NOT re-exported from src/trunk/index.ts so this isolated module
// stays out of the live app's import graph until we bind it in. Import directly:
//   import { MediaStreamServer } from "@/trunk/streaming";

export * from "./types";
export { streamingConfig } from "./config";
export type { StreamingConfig } from "./config";
export { MediaStreamServer } from "./media-stream.server";
export { createStreamingWebhookRouter, buildMediaStreamUrl } from "./webhook";
export type { StreamingWebhookDeps } from "./webhook";
export {
  decideCall,
  type CallRouterDb,
  type CallRouterConfig,
  type CallDecision,
} from "./call-router";
export {
  rejectTwiml,
  sayHangupTwiml,
  forwardTwiml,
  voicemailTwiml,
} from "./twiml";
export {
  createMediaStreamRuntime,
  createRoutingHandlers,
  type MediaStreamRuntime,
  type MediaStreamMode,
  type MediaStreamRuntimeOptions,
  type AgentResolver,
} from "./runtime";
export * as twilioProtocol from "./twilio.protocol";

// Goal 1 — bridge caller audio to a browser listener (G.711 codec + WS pairing).
export { muLawToPcm16, pcm16ToMuLaw } from "./audio.codec";
export { BrowserBridge } from "./browser-bridge";

// Goal 2 — AI answers the caller (speech-to-text -> LLM -> text-to-speech).
export { createAiHandlers, createAgentAwareHandlers, createDefaultBrain } from "./ai/ai.handlers";
export { buildBrainFromAgent } from "./ai/agent.brain";
export { SpeechmaticsTranscriber } from "./ai/speechmatics.transcriber";
export type { AgentRuntimeConfig, SttProvider, LlmProvider, TtsProvider } from "./ai/providers/types";
export {
  echoResponder,
  silentSynthesizer,
  type AiBrain,
  type Transcriber,
  type Responder,
  type Synthesizer,
} from "./ai/brain";
