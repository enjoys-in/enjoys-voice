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
import { PlivoClient } from "../plivo/plivo.client";
import { streamingConfig } from "./config";
import { decideCall, type CallRouterDb } from "./call-router";
import { rejectTwiml, forwardTwiml, voicemailTwiml } from "./twiml";
import { rejectPlivo, forwardPlivo, voicemailPlivo } from "./plivo.twiml";

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
    /** Resolve the inbound routing rule for a dialed number (for an ai_agent override). */
    getRoutingRule?(
      number: string,
    ): Promise<{ destinationType: string; destinationValue: string } | undefined>;
    /** The owner's default (most-recent enabled) AI agent, used for the offline DID fallback. */
    getDefaultAiAgentForOwner?(owner: string): Promise<{ id: number } | undefined>;
  };
  /** Whether voicemail is enabled (from core config.voicemail.enabled). */
  voicemailEnabled?: boolean;
  /** Max voicemail recording length in seconds (from core config). */
  voicemailMaxSec?: number;
}

/** Build the public wss URL the provider connects to, appending the auth token
 * and any extra params (Plivo carries call params here since it has no native
 * custom parameters). */
export function buildMediaStreamUrl(extra: Record<string, string> = {}): string {
  const base =
    streamingConfig.publicWsUrl || `ws://localhost:${streamingConfig.wsPort}`;
  const query = new URLSearchParams();
  if (streamingConfig.authToken) query.set("token", streamingConfig.authToken);
  for (const [k, v] of Object.entries(extra)) query.set(k, v);
  const qs = query.toString();
  if (!qs) return base;
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}${qs}`;
}

/**
 * Self-contained Twilio voice webhook router.
 *  - POST/GET /voice           : route the call → bridge | ai | forward | voicemail | reject
 *  - POST     /voicemail-status : Twilio recording callback → store the voicemail
 *  - GET      /bridge           : browser listen/talk test client
 */
export function createStreamingWebhookRouter(deps: StreamingWebhookDeps = {}): Router {
  const router = Router();
  const provider = streamingConfig.provider;
  // buildStreamInstruction is pure, so empty credentials are fine here — these
  // clients are used ONLY to render the answer XML, never to call the REST API.
  const twilio = new TwilioClient({ accountSid: "", authToken: "" });
  const plivo = new PlivoClient({ authId: "", authToken: "" });

  /** Stream answer XML carrying the per-call mode (bridge|ai) + ids. Twilio gets
   * native <Parameter>s; Plivo can't, so the params ride on the ws URL query. */
  const streamXml = (mode: "bridge" | "ai", params: Record<string, string>): string => {
    const parameters = { mode, ...params };
    if (provider === "plivo") {
      return plivo.buildStreamInstruction({
        wsUrl: buildMediaStreamUrl({ provider: "plivo", ...parameters }),
        bidirectional: true,
        contentType: "audio/x-mulaw;rate=8000",
      });
    }
    return twilio.buildStreamInstruction({
      wsUrl: buildMediaStreamUrl(),
      bidirectional: true,
      parameters,
    });
  };

  /** Reject / forward / voicemail answer XML for the active provider. */
  const rejectXml = (reason: "rejected" | "busy" = "rejected"): string =>
    provider === "plivo" ? rejectPlivo(reason) : rejectTwiml(reason);
  const forwardXml = (target: string, callerId?: string): string =>
    provider === "plivo" ? forwardPlivo(target, callerId) : forwardTwiml(target, callerId);
  const voicemailXml = (opts: {
    greeting: string;
    maxSeconds: number;
    recordingCallbackUrl: string;
  }): string => (provider === "plivo" ? voicemailPlivo(opts) : voicemailTwiml(opts));

  /**
   * Resolve which AI agent should answer an offline call to `owner` on
   * `calledNumber`. A routing rule with an `ai_agent` destination wins (explicit
   * per-DID choice); otherwise the owner's default enabled agent is used. Returns
   * undefined when neither exists, so the runtime falls back to its default brain.
   */
  const resolveAgentId = async (
    owner: string,
    calledNumber: string,
  ): Promise<string | undefined> => {
    const db = deps.db;
    if (!db) return undefined;
    try {
      const rule = calledNumber ? await db.getRoutingRule?.(calledNumber) : undefined;
      if (rule && rule.destinationType === "ai_agent" && rule.destinationValue) {
        return rule.destinationValue;
      }
      const agent = await db.getDefaultAiAgentForOwner?.(owner);
      return agent ? String(agent.id) : undefined;
    } catch (err) {
      console.error(`❌ resolveAgentId(${owner}): ${(err as Error).message}`);
      return undefined;
    }
  };

  const respond = async (req: Request, res: Response): Promise<void> => {
    const calledNumber = (req.body?.To as string) || (req.query.To as string) || "";
    const callerNumber = (req.body?.From as string) || (req.query.From as string) || "";

    // No DB wired in (isolated test mount): keep the simple bridge behaviour.
    if (!deps.db) {
      const bridgeId =
        (typeof req.query.bridgeId === "string" && req.query.bridgeId) ||
        calledNumber ||
        "demo";
      res.type("text/xml").send(streamXml("bridge", { bridgeId }));
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
        doc = streamXml("bridge", {
          bridgeId: decision.bridgeId,
          extension: decision.extension,
          from: callerNumber,
        });
        break;
      case "ai": {
        // Attach the per-DID / per-owner agent so the media runtime builds the
        // right brain; omit the param to let it use the env-default brain.
        const agentId = await resolveAgentId(decision.extension, calledNumber);
        doc = streamXml("ai", {
          extension: decision.extension,
          ...(agentId ? { agentId } : {}),
        });
        break;
      }
      case "forward":
        doc = forwardXml(decision.target, callerNumber || undefined);
        break;
      case "voicemail": {
        const base =
          streamingConfig.publicHttpUrl ||
          `${req.protocol}://${req.get("host") ?? "localhost"}`;
        const cbUrl =
          `${base}${req.baseUrl}/voicemail-status` +
          `?mailbox=${encodeURIComponent(decision.extension)}` +
          `&from=${encodeURIComponent(callerNumber)}`;
        doc = voicemailXml({
          greeting: "The person you are calling is not available. Please leave a message after the beep.",
          maxSeconds: deps.voicemailMaxSec ?? 120,
          recordingCallbackUrl: cbUrl,
        });
        break;
      }
      case "reject":
      default:
        doc = rejectXml("rejected");
        break;
    }
    res.type("text/xml").send(doc);
  };

  router.post("/voice", respond);
  router.get("/voice", respond);

  // Recording callback: persist the finished voicemail. Field names differ by
  // provider — Twilio posts RecordingUrl/RecordingSid, Plivo posts RecordUrl/
  // RecordingID — so we accept either. The provider hosts the audio; downloading
  // it into the local voicemail store is a follow-up — we store the URL now.
  router.post("/voicemail-status", async (req: Request, res: Response) => {
    try {
      const mailbox = String(req.query.mailbox || "");
      const from = String(req.query.from || req.body?.From || "unknown");
      const recordingUrl = String(req.body?.RecordingUrl || req.body?.RecordUrl || "");
      const duration = parseInt(String(req.body?.RecordingDuration || "0"), 10);
      if (mailbox && recordingUrl && deps.db?.addVoicemail) {
        await deps.db.addVoicemail({
          id: String(req.body?.RecordingSid || req.body?.RecordingID || randomUUID()),
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
