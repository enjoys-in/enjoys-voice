// PSTN inbound voice webhook (the "pstn thing").
//
// When a call hits your Twilio number, Twilio POSTs to its configured Voice URL.
// We run the call router (decideCall) over the live DB + settings and answer
// with the matching TwiML:
//   bridge   -> <Connect><Stream mode=bridge>  (ring the owner's browser)
//   ai       -> <Connect><Stream mode=ai>      (AI answers; offline fallback)
//   forward  -> <Dial>target</Dial>            (forward-on-unavailable)
//   voicemail-> <Say> + <Record>               (leave a message)
//   reject   -> <Reject/>                       (blocked / unknown / unavailable)
//
// Without `db` (e.g. an isolated test mount) it falls back to a plain bridge so
// the module still works standalone.
//
// ISOLATION: this Router is mounted on the live HttpServer (at /api/n/media)
// only when MEDIA_STREAM_ENABLED is set, so default deployments are unaffected.

import { Router, type Request, type Response } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { TwilioClient } from "../twilio";
import { streamingConfig } from "./config";
import { decideCall, type CallRouterDb } from "./call-router";
import { rejectTwiml, forwardTwiml, voicemailTwiml } from "./twiml";

/** A stored voicemail record (structural — matches core's Voicemail shape). */
interface VoicemailRecord {
  id: string;
  mailbox: string;
  from: string;
  fromName: string;
  file: string;
  duration?: number;
  createdAt: string;
  read: boolean;
}

/** Dependencies the webhook needs to make routing decisions on the live system. */
export interface StreamingWebhookDeps {
  /** Live database for presence / block / forwarding lookups. Omit = bridge-only. */
  db?: CallRouterDb & {
    addVoicemail?(vm: VoicemailRecord): Promise<void> | void;
  };
  /** Whether voicemail is enabled (from core config.voicemail.enabled). */
  voicemailEnabled?: boolean;
  /** Max voicemail recording length in seconds (from core config). */
  voicemailMaxSec?: number;
}

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
 *  - POST/GET /voice           : route the call → bridge | ai | forward | voicemail | reject
 *  - POST     /voicemail-status : Twilio recording callback → store the voicemail
 *  - GET      /bridge           : browser listen/talk test client
 */
export function createStreamingWebhookRouter(deps: StreamingWebhookDeps = {}): Router {
  const router = Router();
  // buildStreamInstruction is pure, so empty credentials are fine here — this
  // client is used ONLY to render TwiML, never to call the Twilio REST API.
  const twiml = new TwilioClient({ accountSid: "", authToken: "" });

  /** <Connect><Stream> TwiML carrying the per-call mode (bridge|ai) + ids. */
  const streamTwiml = (mode: "bridge" | "ai", params: Record<string, string>): string =>
    twiml.buildStreamInstruction({
      wsUrl: buildMediaStreamUrl(),
      bidirectional: true,
      parameters: { mode, ...params },
    });

  const respond = (req: Request, res: Response): void => {
    const calledNumber = (req.body?.To as string) || (req.query.To as string) || "";
    const callerNumber = (req.body?.From as string) || (req.query.From as string) || "";

    // No DB wired in (isolated test mount): keep the simple bridge behaviour.
    if (!deps.db) {
      const bridgeId =
        (typeof req.query.bridgeId === "string" && req.query.bridgeId) ||
        calledNumber ||
        "demo";
      res.type("text/xml").send(streamTwiml("bridge", { bridgeId }));
      return;
    }

    const decision = decideCall(calledNumber, callerNumber, deps.db, {
      aiEnabled: streamingConfig.ai.enabled,
      voicemailEnabled: deps.voicemailEnabled ?? false,
    });
    console.log(
      `📞 route ${callerNumber || "?"} → ${calledNumber || "?"} : ${decision.action}` +
        ("reason" in decision ? ` (${decision.reason})` : ""),
    );

    let doc: string;
    switch (decision.action) {
      case "bridge":
        doc = streamTwiml("bridge", {
          bridgeId: decision.bridgeId,
          extension: decision.extension,
        });
        break;
      case "ai":
        doc = streamTwiml("ai", { extension: decision.extension });
        break;
      case "forward":
        doc = forwardTwiml(decision.target, callerNumber || undefined);
        break;
      case "voicemail": {
        const base =
          streamingConfig.publicHttpUrl ||
          `${req.protocol}://${req.get("host") ?? "localhost"}`;
        const cbUrl =
          `${base}${req.baseUrl}/voicemail-status` +
          `?mailbox=${encodeURIComponent(decision.extension)}` +
          `&from=${encodeURIComponent(callerNumber)}`;
        doc = voicemailTwiml({
          greeting: "The person you are calling is not available. Please leave a message after the beep.",
          maxSeconds: deps.voicemailMaxSec ?? 120,
          recordingCallbackUrl: cbUrl,
        });
        break;
      }
      case "reject":
      default:
        doc = rejectTwiml("rejected");
        break;
    }
    res.type("text/xml").send(doc);
  };

  router.post("/voice", respond);
  router.get("/voice", respond);

  // Twilio recording callback: persist the finished voicemail. Twilio hosts the
  // audio at RecordingUrl; downloading it into the local voicemail store (so it
  // plays alongside FreeSWITCH voicemails) is a follow-up — we store the URL now.
  router.post("/voicemail-status", async (req: Request, res: Response) => {
    try {
      const mailbox = String(req.query.mailbox || "");
      const from = String(req.query.from || req.body?.From || "unknown");
      const recordingUrl = String(req.body?.RecordingUrl || "");
      const duration = parseInt(String(req.body?.RecordingDuration || "0"), 10);
      if (mailbox && recordingUrl && deps.db?.addVoicemail) {
        await deps.db.addVoicemail({
          id: String(req.body?.RecordingSid || randomUUID()),
          mailbox,
          from,
          fromName: from,
          file: recordingUrl,
          duration: Number.isFinite(duration) ? duration : 0,
          createdAt: new Date().toISOString(),
          read: false,
        });
        console.log(`📨 voicemail stored for ${mailbox} from ${from} (${duration}s)`);
      }
    } catch (err) {
      console.error(`❌ voicemail-status: ${(err as Error).message}`);
    }
    res.type("text/xml").send('<?xml version="1.0" encoding="UTF-8"?><Response/>');
  });

  // Browser test client (listen / talk). Served from this same router so it's
  // reachable on whatever Express server mounts it — no standalone server needed.
  const here = path.dirname(fileURLToPath(import.meta.url));
  router.get("/bridge", (_req, res) => {
    res.sendFile(path.join(here, "public", "bridge-test.html"));
  });

  return router;
}
