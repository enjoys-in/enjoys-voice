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
export {
  createMediaStreamRuntime,
  type MediaStreamRuntime,
  type MediaStreamMode,
} from "./runtime";
export * as twilioProtocol from "./twilio.protocol";

// Goal 1 — bridge caller audio to a browser listener (G.711 codec + WS pairing).
export { muLawToPcm16, pcm16ToMuLaw } from "./audio.codec";
export { BrowserBridge } from "./browser-bridge";

// Goal 2 — AI answers the caller (speech-to-text -> LLM -> text-to-speech).
export { createAiHandlers, createDefaultBrain } from "./ai/ai.handlers";
export { SpeechmaticsTranscriber } from "./ai/speechmatics.transcriber";
export {
  echoResponder,
  silentSynthesizer,
  type AiBrain,
  type Transcriber,
  type Responder,
  type Synthesizer,
} from "./ai/brain";
