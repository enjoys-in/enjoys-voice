// PSTN inbound voice webhook (the "pstn thing").
//
// When a call hits your Twilio number, Twilio POSTs to its configured Voice URL.
// We answer with <Connect><Stream> TwiML that tells Twilio to open a TWO-WAY
// audio WebSocket to our MediaStreamServer. The TwiML itself is built by the
// existing TwilioClient.buildStreamInstruction (pure; no network/credentials).
//
// ISOLATION: this Router is mounted on the live HttpServer (at /api/n/media)
// only when MEDIA_STREAM_ENABLED is set, so default deployments are unaffected.

import { Router, type Request, type Response } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
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

  const respond = (req: Request, res: Response): void => {
    // bridgeId pairs this call with a browser listener (BrowserBridge keys on it).
    // Pick it from ?bridgeId=, else the called number (To), else a demo default.
    const bridgeId =
      (typeof req.query.bridgeId === "string" && req.query.bridgeId) ||
      (typeof req.body?.To === "string" && req.body.To) ||
      "demo";
    const doc = twiml.buildStreamInstruction({
      wsUrl: buildMediaStreamUrl(),
      bidirectional: true,
      parameters: { bridgeId },
    });
    res.type("text/xml").send(doc);
  };

  router.post("/voice", respond);
  router.get("/voice", respond);

  // Browser test client (listen / talk). Served from this same router so it's
  // reachable on whatever Express server mounts it — no standalone server needed.
  const here = path.dirname(fileURLToPath(import.meta.url));
  router.get("/bridge", (_req, res) => {
    res.sendFile(path.join(here, "public", "bridge-test.html"));
  });

  return router;
}
