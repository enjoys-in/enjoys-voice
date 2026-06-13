// PSTN inbound voice webhook (the "pstn thing").
//
// When a call hits your Twilio number, Twilio POSTs to its configured Voice URL.
// We answer with <Connect><Stream> TwiML that tells Twilio to open a TWO-WAY
// audio WebSocket to our MediaStreamServer. The TwiML itself is built by the
// existing TwilioClient.buildStreamInstruction (pure; no network/credentials).
//
// ISOLATION: this Router is NOT mounted on the live HttpServer. The standalone
// runner mounts it on its own port; later we mount it under /api/n instead.

import { Router, type Request, type Response } from "express";
import { TwilioClient } from "../twilio";
import { streamingConfig } from "./config";

/** Build the public wss URL Twilio connects to, appending the auth token. */
export function buildMediaStreamUrl(): string {
  const base =
    streamingConfig.publicWsUrl || `ws://localhost:${streamingConfig.wsPort}`;
  if (!streamingConfig.authToken) return base;
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}token=${encodeURIComponent(streamingConfig.authToken)}`;
}

/**
 * Self-contained Twilio voice webhook router.
 *  - POST /voice : returns <Connect><Stream> TwiML (two-way audio).
 *  - GET  /voice : same TwiML, for quick browser inspection.
 */
export function createStreamingWebhookRouter(): Router {
  const router = Router();
  // buildStreamInstruction is pure, so empty credentials are fine here — this
  // client is used ONLY to render TwiML, never to call the Twilio REST API.
  const twiml = new TwilioClient({ accountSid: "", authToken: "" });

  const respond = (_req: Request, res: Response): void => {
    const doc = twiml.buildStreamInstruction({
      wsUrl: buildMediaStreamUrl(),
      bidirectional: true,
    });
    res.type("text/xml").send(doc);
  };

  router.post("/voice", respond);
  router.get("/voice", respond);

  return router;
}
