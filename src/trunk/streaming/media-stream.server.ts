// Standalone media-streaming WebSocket server.
//
// This is the "wss where we listen to call audio". A provider (Twilio today)
// opens a WebSocket here after a call connects and streams raw audio; with a
// bidirectional stream we can also push audio back to the caller.
//
// ISOLATION: runs on its OWN port and is NOT mounted on the signaling
// SignalingServer (which requires a browser cookie JWT that Twilio cannot send).
// Auth here is a shared secret in the URL query, suited to server-to-server
// callbacks. The internal system binds in LATER via MediaStreamHandlers.

import { WebSocketServer as WsServer, WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import { randomUUID } from "node:crypto";
import { streamingConfig } from "./config";
import type {
  MediaFrame,
  MediaSession,
  MediaStreamHandlers,
  StreamStartMeta,
} from "./types";
import {
  decodeTwilioMedia,
  decodeTwilioStart,
  encodeTwilioClear,
  encodeTwilioMark,
  encodeTwilioMedia,
} from "./twilio.protocol";
import {
  decodePlivoMedia,
  decodePlivoStart,
  encodePlivoClear,
  encodePlivoMark,
  encodePlivoMedia,
} from "./plivo.protocol";
import {
  decodeFreeswitchStart,
  decodeFreeswitchMedia,
  encodeFreeswitchClear,
  encodeFreeswitchMark,
  encodeFreeswitchMedia,
} from "./freeswitch.protocol";

/**
 * A media-provider wire codec. Twilio and Plivo both speak start/media/stop JSON
 * over the socket but with different framing and (for Plivo) out-of-band params,
 * so the server picks one per connection and stays provider-agnostic otherwise.
 */
interface StreamProtocol {
  decodeStart(msg: any, urlParams: Record<string, string>): StreamStartMeta;
  decodeMedia(msg: any): MediaFrame;
  encodeMedia(streamId: string, audio: Buffer): string;
  encodeClear(streamId: string): string;
  encodeMark(streamId: string, name: string): string;
}

const TWILIO_PROTOCOL: StreamProtocol = {
  decodeStart: (msg) => decodeTwilioStart(msg),
  decodeMedia: decodeTwilioMedia,
  encodeMedia: encodeTwilioMedia,
  encodeClear: encodeTwilioClear,
  encodeMark: encodeTwilioMark,
};

const PLIVO_PROTOCOL: StreamProtocol = {
  decodeStart: (msg, urlParams) => decodePlivoStart(msg, urlParams),
  decodeMedia: decodePlivoMedia,
  encodeMedia: encodePlivoMedia,
  encodeClear: encodePlivoClear,
  encodeMark: encodePlivoMark,
};

const FREESWITCH_PROTOCOL: StreamProtocol = {
  decodeStart: (msg, urlParams) => decodeFreeswitchStart(msg, urlParams),
  decodeMedia: decodeFreeswitchMedia,
  encodeMedia: encodeFreeswitchMedia,
  encodeClear: encodeFreeswitchClear,
  encodeMark: encodeFreeswitchMark,
};

function selectProtocol(provider: string): StreamProtocol {
  if (provider === "plivo") return PLIVO_PROTOCOL;
  if (provider === "freeswitch") return FREESWITCH_PROTOCOL;
  return TWILIO_PROTOCOL;
}

export class MediaStreamServer {
  private wss?: WsServer;

  /** @param handlers Optional hooks; defaults to none so the server runs bare. */
  constructor(private readonly handlers: MediaStreamHandlers = {}) {}

  start(): void {
    this.wss = new WsServer({
      port: streamingConfig.wsPort,
      // Twilio/Plivo are server-to-server (no Origin header), so CSWSH origin
      // checks don't apply. Gate instead on the shared token in the URL query.
      verifyClient: (
        info: { origin: string; secure: boolean; req: IncomingMessage },
        cb: (ok: boolean, code?: number, message?: string) => void,
      ) => {
        const ok = this.checkAuth(info.req);
        cb(ok, ok ? undefined : 401, ok ? undefined : "Unauthorized");
      },
    });

    this.wss.on("listening", () =>
      console.log(`✅ Media WS: listening on :${streamingConfig.wsPort}`),
    );
    this.wss.on("connection", (ws: WebSocket, req: IncomingMessage) =>
      this.onConnection(ws, req),
    );
  }

  stop(): void {
    this.wss?.close();
  }

  /** Validate the `?token=` query param against the configured shared secret. */
  private checkAuth(req: IncomingMessage): boolean {
    if (!streamingConfig.authToken) return true; // open in local dev
    try {
      const url = new URL(req.url ?? "", "http://localhost");
      return url.searchParams.get("token") === streamingConfig.authToken;
    } catch {
      return false;
    }
  }

  private onConnection(ws: WebSocket, req: IncomingMessage): void {
    // Pick the wire codec for this connection. The provider rides on the URL
    // query (the webhook sets ?provider=plivo); default is Twilio. Plivo lacks
    // native custom parameters, so we also lift the query pairs (mode/agentId/
    // extension) here and inject them into its `start` metadata.
    const { provider, urlParams } = this.parseConnectionUrl(req);
    const proto = selectProtocol(provider);

    // The session is created on the provider `start` event (we need its
    // streamId to send audio back). Frames before `start` are ignored.
    let session: MediaSession | undefined;
    let stopped = false;

    const fireStop = () => {
      if (session && !stopped) {
        stopped = true;
        this.handlers.onStop?.(session);
      }
    };

    ws.on("message", (raw: Buffer, isBinary: boolean) => {
      let msg: any;
      
      if (isBinary) {
        if (provider !== "freeswitch") return; // Unexpected binary frame from other providers
        msg = { event: "media", payload: raw };
      } else {
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          return; // ignore non-JSON string frames
        }
      }

      switch (msg.event) {
        case "connected":
          break; // handshake ack; nothing to do

        case "start": {
          const meta = proto.decodeStart(msg, urlParams);
          session = this.createSession(ws, meta, proto);
          this.handlers.onStart?.(session, meta);
          break;
        }

        case "media": {
          if (!session) break;
          const frame = proto.decodeMedia(msg);
          // Dev two-way proof: echo caller audio straight back.
          if (streamingConfig.echo) session.sendAudio(frame.audio);
          this.handlers.onAudio?.(session, frame);
          break;
        }

        case "dtmf":
          if (session && msg.dtmf?.digit)
            this.handlers.onDtmf?.(session, String(msg.dtmf.digit));
          break;

        case "mark":
          if (session && msg.mark?.name)
            this.handlers.onMark?.(session, String(msg.mark.name));
          break;

        case "stop":
          fireStop();
          break;
      }
    });

    ws.on("close", () => fireStop());
    ws.on("error", (err: Error) => this.handlers.onError?.(session, err));
  }

  /**
   * Read the connection URL: the provider selector plus the caller-supplied
   * params (everything except the auth token / provider selector) that Plivo
   * needs carried out-of-band. Twilio ignores `urlParams` (it uses start
   * customParameters), so this is harmless there.
   */
  private parseConnectionUrl(req: IncomingMessage): {
    provider: string;
    urlParams: Record<string, string>;
  } {
    const urlParams: Record<string, string> = {};
    let provider: string = streamingConfig.provider;
    try {
      const url = new URL(req.url ?? "", "http://localhost");
      provider = url.searchParams.get("provider") || provider;
      for (const [k, v] of url.searchParams) {
        if (k === "token" || k === "provider") continue;
        urlParams[k] = v;
      }
    } catch {
      /* fall back to configured provider with no params */
    }
    return { provider, urlParams };
  }

  /** Build the MediaSession control surface bound to this socket. */
  private createSession(
    ws: WebSocket,
    meta: StreamStartMeta,
    proto: StreamProtocol,
  ): MediaSession {
    const streamSid = meta.streamId;
    const sendIfOpen = (data: string) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    };
    return {
      id: randomUUID(),
      provider: meta.provider,
      streamId: streamSid,
      callId: meta.callId,
      sendAudio: (audio: Buffer) => sendIfOpen(proto.encodeMedia(streamSid, audio)),
      clearAudio: () => sendIfOpen(proto.encodeClear(streamSid)),
      mark: (name: string) => sendIfOpen(proto.encodeMark(streamSid, name)),
      close: () => ws.close(),
    };
  }
}
