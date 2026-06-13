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

export class MediaStreamServer {
  private wss?: WsServer;

  /** @param handlers Optional hooks; defaults to none so the server runs bare. */
  constructor(private readonly handlers: MediaStreamHandlers = {}) {}

  start(): void {
    this.wss = new WsServer({
      port: streamingConfig.wsPort,
      // Twilio is server-to-server (no Origin header), so CSWSH origin checks
      // don't apply. Gate instead on the shared token in the URL query.
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
    this.wss.on("connection", (ws: WebSocket) => this.onConnection(ws));
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

  private onConnection(ws: WebSocket): void {
    // The session is created on the provider `start` event (we need its
    // streamSid to send audio back). Frames before `start` are ignored.
    let session: MediaSession | undefined;
    let stopped = false;

    const fireStop = () => {
      if (session && !stopped) {
        stopped = true;
        this.handlers.onStop?.(session);
      }
    };

    ws.on("message", (raw: Buffer) => {
      let msg: any;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return; // ignore non-JSON frames
      }

      switch (msg.event) {
        case "connected":
          break; // handshake ack; nothing to do

        case "start": {
          const meta = decodeTwilioStart(msg);
          session = this.createSession(ws, meta);
          this.handlers.onStart?.(session, meta);
          break;
        }

        case "media": {
          if (!session) break;
          const frame = decodeTwilioMedia(msg);
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

  /** Build the MediaSession control surface bound to this socket. */
  private createSession(ws: WebSocket, meta: StreamStartMeta): MediaSession {
    const streamSid = meta.streamId;
    const sendIfOpen = (data: string) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    };
    return {
      id: randomUUID(),
      provider: meta.provider,
      streamId: streamSid,
      callId: meta.callId,
      sendAudio: (audio: Buffer) => sendIfOpen(encodeTwilioMedia(streamSid, audio)),
      clearAudio: () => sendIfOpen(encodeTwilioClear(streamSid)),
      mark: (name: string) => sendIfOpen(encodeTwilioMark(streamSid, name)),
      close: () => ws.close(),
    };
  }
}
