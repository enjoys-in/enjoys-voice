// Isolated environment config for the media-streaming module.
//
// Kept SEPARATE from src/core/config.ts on purpose so all media-streaming env
// lives in one place. The live app reads it via @/trunk/streaming and only
// activates the feature when `enabled` is true (MEDIA_STREAM_ENABLED).

/** Streaming module configuration, read once from the environment. */
export interface StreamingConfig {
  /** Master switch: when false the live app does not start media streaming. */
  enabled: boolean;
  /** Port the media WebSocket server listens on (Twilio connects here). */
  wsPort: number;
  /**
   * Public `wss://` base URL Twilio dials back to (e.g. wss://voice.example/media).
   * Empty falls back to ws://localhost:<wsPort> for local testing.
   */
  publicWsUrl: string;
  /**
   * Public `https://` base URL of this server, used to build absolute callback
   * URLs in TwiML (e.g. the voicemail recording callback). Empty = derive from
   * the incoming request's host header.
   */
  publicHttpUrl: string;
  /**
   * Shared secret appended to the stream URL as `?token=` and validated on the
   * WebSocket handshake. Empty = open (local dev only; set in production).
   */
  authToken: string;
  /** Dev only: echo caller audio straight back to prove two-way audio works. */
  echo: boolean;
  /** Browser-bridge audio WebSocket port (the page connects here to listen/talk). */
  bridgeWsPort: number;
  /** AI voice-agent settings. */
  ai: {
    /** Master switch for the AI fallback (offline path). */
    enabled: boolean;
    /** Speechmatics API key for real-time speech-to-text (createSpeechmaticsJWT). */
    speechmaticsApiKey: string;
    /** Speechmatics Realtime endpoint URL (region-specific); empty = library default. */
    speechmaticsUrl: string;
    /** ASR language (ISO code), e.g. "en". */
    language: string;
    /** OpenAI API key (LLM Responder, provider "openai"). */
    openaiApiKey: string;
    /** Google Gemini API key (LLM Responder, provider "gemini"). */
    geminiApiKey: string;
    /** Sarvam API key (TTS Synthesizer, provider "sarvam"). */
    sarvamApiKey: string;
    /** Deepgram API key (TTS Synthesizer + streaming STT, provider "deepgram"). */
    deepgramApiKey: string;
  };
  /**
   * Which trunk/media provider carries calls into the media WS: "twilio" or
   * "plivo". Drives both the voice-webhook XML dialect and how inbound audio
   * frames are decoded. Defaults to twilio for backwards compatibility.
   */
  provider: "twilio" | "plivo";
}

function resolveProvider(): "twilio" | "plivo" {
  const raw = (
    process.env.MEDIA_STREAM_PROVIDER ||
    process.env.SIP_TRUNK_PROVIDER ||
    "twilio"
  ).toLowerCase();
  return raw === "plivo" ? "plivo" : "twilio";
}

export const streamingConfig: StreamingConfig = {
  enabled: process.env.MEDIA_STREAM_ENABLED === "true",
  wsPort: parseInt(process.env.MEDIA_STREAM_WS_PORT || "3004"),
  publicWsUrl: process.env.MEDIA_STREAM_PUBLIC_URL || "",
  publicHttpUrl: process.env.MEDIA_STREAM_PUBLIC_HTTP_URL || "",
  authToken: process.env.MEDIA_STREAM_AUTH_TOKEN || "",
  echo: process.env.MEDIA_STREAM_ECHO === "true",
  bridgeWsPort: parseInt(process.env.MEDIA_STREAM_BRIDGE_PORT || "3005"),
  ai: {
    enabled: process.env.MEDIA_STREAM_AI_ENABLED === "true",
    speechmaticsApiKey: process.env.SPEECHMATICS_API_KEY || "",
    speechmaticsUrl: process.env.SPEECHMATICS_RT_URL || "",
    language: process.env.MEDIA_STREAM_AI_LANGUAGE || "en",
    openaiApiKey: process.env.OPENAI_API_KEY || "",
    geminiApiKey: process.env.GEMINI_API_KEY || "",
    sarvamApiKey: process.env.SARVAM_API_KEY || "",
    deepgramApiKey: process.env.DEEPGRAM_API_KEY || "",
  },
  provider: resolveProvider(),
};
