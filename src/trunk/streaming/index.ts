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
export * as twilioProtocol from "./twilio.protocol";
