// Bridge: PSTN caller audio <-> browser listener (two-way).
//
// Goal 1 ("send the audio to the browser so a person can listen/talk"): pairs a
// live Twilio media session with a browser WebSocket so a human in the browser
// hears the caller and talks back, WITHOUT being a SIP phone.
//
//   caller -> Twilio -> MediaStreamServer --(onAudio, mu-law)-->
//             muLawToPcm16 --> browser WS (binary PCM16LE 8k)   [person hears]
//   person mic --> browser WS (binary PCM16LE 8k) -->
//             pcm16ToMuLaw --> session.sendAudio --> Twilio --> caller
//
// PAIRING: each call is keyed by `bridgeId` = the Twilio <Parameter name="bridgeId">
// custom value, falling back to callSid then streamSid. The browser connects to
// this server at  ws://<host>:<bridgeWsPort>/?id=<bridgeId>[&token=...].
//
// BROWSER WIRE CONTRACT
//   server -> browser : binary  = caller audio, PCM16LE 8 kHz mono
//                       text    = JSON control: {type:"linked"|"stop"}
//   browser -> server : binary  = mic audio,    PCM16LE 8 kHz mono
//                       text    = JSON control: {type:"hangup"}
//
// ISOLATION: standalone WS server on its own port; not mounted on SignalingServer.

import { WebSocketServer as WsServer, WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import { streamingConfig } from "./config";
import { muLawToPcm16, pcm16ToMuLaw } from "./audio.codec";
import type { MediaSession, MediaStreamHandlers, StreamStartMeta } from "./types";

/** A caller<->browser pairing. Either side may arrive first. */
interface Pair {
  session?: MediaSession;
  browser?: WebSocket;
}

export class BrowserBridge {
  private wss?: WsServer;
  private readonly pairs = new Map<string, Pair>();

  /** Derive the pairing key from the stream's custom parameters / ids. */
  private static keyOf(meta: StreamStartMeta): string {
    return meta.parameters.bridgeId || meta.callId || meta.streamId;
  }

  private pair(key: string): Pair {
    let p = this.pairs.get(key);
    if (!p) {
      p = {};
      this.pairs.set(key, p);
    }
    return p;
  }

  // ─── Browser-facing WebSocket server ───────────────────────────────
  start(): void {
    this.wss = new WsServer({
      port: streamingConfig.bridgeWsPort,
      verifyClient: (
        info: { origin: string; secure: boolean; req: IncomingMessage },
        cb: (ok: boolean, code?: number, message?: string) => void,
      ) => {
        const ok = this.checkAuth(info.req);
        cb(ok, ok ? undefined : 401, ok ? undefined : "Unauthorized");
      },
    });
    this.wss.on("listening", () =>
      console.log(`✅ Bridge WS: browser audio on :${streamingConfig.bridgeWsPort}`),
    );
    this.wss.on("connection", (ws: WebSocket, req: IncomingMessage) =>
      this.onBrowser(ws, req),
    );
  }

  stop(): void {
    this.wss?.close();
  }

  private checkAuth(req: IncomingMessage): boolean {
    if (!streamingConfig.authToken) return true;
    try {
      const url = new URL(req.url ?? "", "http://localhost");
      return url.searchParams.get("token") === streamingConfig.authToken;
    } catch {
      return false;
    }
  }

  private onBrowser(ws: WebSocket, req: IncomingMessage): void {
    let key: string;
    try {
      key = new URL(req.url ?? "", "http://localhost").searchParams.get("id") || "";
    } catch {
      key = "";
    }
    if (!key) {
      ws.close(4400, "Missing ?id");
      return;
    }

    const p = this.pair(key);
    p.browser = ws;
    if (p.session) this.send(ws, { type: "linked" });

    ws.on("message", (raw: Buffer, isBinary: boolean) => {
      if (isBinary) {
        // Mic audio (PCM16LE 8k) -> mu-law -> caller.
        p.session?.sendAudio(pcm16ToMuLaw(raw));
      } else {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.type === "hangup") p.session?.close();
        } catch {
          /* ignore non-JSON control frames */
        }
      }
    });

    ws.on("close", () => {
      if (p.browser === ws) p.browser = undefined;
      this.cleanup(key);
    });
    ws.on("error", () => {
      if (p.browser === ws) p.browser = undefined;
    });
  }

  private send(ws: WebSocket, obj: unknown): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  }

  private cleanup(key: string): void {
    const p = this.pairs.get(key);
    if (p && !p.session && !p.browser) this.pairs.delete(key);
  }

  // ─── MediaStreamHandlers (the Twilio side) ─────────────────────────
  /** Handlers to pass into MediaStreamServer so caller audio bridges here. */
  handlers(): MediaStreamHandlers {
    return {
      onStart: (session, meta) => {
        const key = BrowserBridge.keyOf(meta);
        const p = this.pair(key);
        p.session = session;
        (session as { bridgeKey?: string }).bridgeKey = key;
        if (p.browser) this.send(p.browser, { type: "linked" });
        console.log(`🔗 Bridge: caller ${session.callId ?? key} ready (key=${key})`);
      },
      onAudio: (session, frame) => {
        const key = (session as { bridgeKey?: string }).bridgeKey;
        const browser = key ? this.pairs.get(key)?.browser : undefined;
        if (browser && browser.readyState === WebSocket.OPEN) {
          browser.send(muLawToPcm16(frame.audio)); // binary PCM16 to the page
        }
      },
      onStop: (session) => {
        const key = (session as { bridgeKey?: string }).bridgeKey;
        if (!key) return;
        const p = this.pairs.get(key);
        if (p?.browser) this.send(p.browser, { type: "stop" });
        if (p) p.session = undefined;
        this.cleanup(key);
        console.log(`🔗 Bridge: caller ${session.callId ?? key} ended (key=${key})`);
      },
      onError: (_session, err) => console.error(`❌ Bridge error: ${err.message}`),
    };
  }
}
