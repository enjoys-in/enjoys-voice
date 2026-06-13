// Isolated environment config for the media-streaming module.
//
// Kept SEPARATE from src/core/config.ts on purpose: this module is standalone
// and not yet wired into the live app, so its env lives here. When we bind it
// in later, these can be folded into the core AppConfig.

/** Streaming module configuration, read once from the environment. */
export interface StreamingConfig {
  /** Master switch for the standalone runner. */
  enabled: boolean;
  /** Port the media WebSocket server listens on (Twilio connects here). */
  wsPort: number;
  /** Port the standalone voice-webhook HTTP server listens on. */
  webhookPort: number;
  /**
   * Public `wss://` base URL Twilio dials back to (e.g. wss://voice.example/media).
   * Empty falls back to ws://localhost:<wsPort> for local testing.
   */
  publicWsUrl: string;
  /**
   * Shared secret appended to the stream URL as `?token=` and validated on the
   * WebSocket handshake. Empty = open (local dev only; set in production).
   */
  authToken: string;
  /** Dev only: echo caller audio straight back to prove two-way audio works. */
  echo: boolean;
}

export const streamingConfig: StreamingConfig = {
  enabled: process.env.MEDIA_STREAM_ENABLED === "true",
  wsPort: parseInt(process.env.MEDIA_STREAM_WS_PORT || "3003"),
  webhookPort: parseInt(process.env.MEDIA_STREAM_WEBHOOK_PORT || "3004"),
  publicWsUrl: process.env.MEDIA_STREAM_PUBLIC_URL || "",
  authToken: process.env.MEDIA_STREAM_AUTH_TOKEN || "",
  echo: process.env.MEDIA_STREAM_ECHO === "true",
};
