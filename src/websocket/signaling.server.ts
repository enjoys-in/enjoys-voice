import { WebSocketServer as WsServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import fs from 'fs';
import path from 'path';
import { config, verifyAccessToken, parseCookies } from '@/core';
import type { JwtClaims } from '@/core';
import { DatabaseService } from '@/services';

interface WsClient {
  ws: WebSocket;
  extension: string;
  username: string;
  authenticated: boolean;
  userId?: number;
}

export class SignalingServer {
  private wss!: WsServer;
  private clients = new Map<string, WsClient>();

  constructor(private db: DatabaseService) {}

  start(): void {
    this.wss = new WsServer({
      port: config.server.wsPort,
      // CSWSH defense: unlike fetch(), WebSocket upgrades are NOT covered by
      // CORS, yet the browser still auto-attaches our auth cookie. Reject any
      // origin that is not explicitly allowed before the handshake completes.
      verifyClient: (info: { origin: string; secure: boolean; req: IncomingMessage }) =>
        this.isAllowedOrigin(info.origin),
    });

    this.wss.on('listening', () => {
      console.log(`✅ WS: Signaling server on port ${config.server.wsPort}`);
    });

    this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      const client: WsClient = { ws, extension: '', username: '', authenticated: false };

      // Authenticate from the httpOnly access-token cookie the Go API set on
      // login. The browser attaches it automatically to the upgrade request,
      // so the client never has to (and cannot) read or send it itself.
      const cookies = parseCookies(req.headers.cookie);
      const claims = verifyAccessToken(cookies.token);
      if (!claims) {
        this.send(ws, { type: 'error', message: 'Unauthorized' });
        ws.close(4401, 'Unauthorized');
        return;
      }
      this.authenticateClient(client, claims);

      ws.on('message', (raw: Buffer) => {
        try {
          const msg = JSON.parse(raw.toString());
          this.handleMessage(client, msg);
        } catch {
          this.send(ws, { type: 'error', message: 'Invalid JSON' });
        }
      });

      ws.on('close', () => {
        if (client.extension) this.clients.delete(client.extension);
        this.broadcastPresence();
      });

      ws.on('error', () => {
        if (client.extension) this.clients.delete(client.extension);
      });
    });
  }

  /**
   * Decide whether a browser Origin may open the signaling socket.
   *  - No Origin header → non-browser client (native socket, tests, S2S); CSWSH
   *    is a browser-only attack, so these are allowed.
   *  - ALLOWED_ORIGINS set → must match the allowlist exactly (production).
   *  - Otherwise (dev) → allow localhost / 127.0.0.1 on any port.
   */
  private isAllowedOrigin(origin?: string): boolean {
    if (!origin) return true;
    if (config.auth.allowedOrigins.length > 0) {
      return config.auth.allowedOrigins.includes(origin);
    }
    try {
      const { hostname } = new URL(origin);
      return hostname === 'localhost' || hostname === '127.0.0.1';
    } catch {
      return false;
    }
  }

  private handleMessage(client: WsClient, msg: any): void {
    switch (msg.type) {
      case 'auth':
      case 'register':
        this.handleAuth(client);
        break;
      case 'call':
        this.handleCallSignal(client, msg);
        break;
      case 'presence':
      case 'get_online_users':
        this.handlePresence(client);
        break;
      case 'recording':
        this.handleRecording(client, msg);
        break;
      default:
        this.send(client.ws, { type: 'error', message: `Unknown type: ${msg.type}` });
    }
  }

  /**
   * Bind a verified token to the connection. Called once at handshake time.
   * The identity comes solely from the JWT claims — never from the message body
   * — so a client cannot register as someone else. Passwords are not involved:
   * possession of a valid, unexpired access token IS the proof of identity.
   */
  private authenticateClient(client: WsClient, claims: JwtClaims): void {
    const user = this.db.getUser(claims.extension);
    client.authenticated = true;
    client.extension = claims.extension;
    client.username = user?.username || claims.extension;
    client.userId = claims.user_id;
    this.clients.set(client.extension, client);
    this.sendRegistered(client);
    this.broadcastPresence();
  }

  private sendRegistered(client: WsClient): void {
    const user = this.db.getUser(client.extension);
    this.send(client.ws, {
      type: 'registered',
      user: { extension: client.extension, name: user?.name || client.extension, username: client.username },
      sipWsUrl: config.server.publicSipWsUrl || `ws://${config.server.publicIp}:${config.sipWs.port}`,
    });
  }

  /**
   * Handle a client-sent `register`/`auth` message. Authentication already
   * happened at the WS handshake via the access-token cookie, so this is just
   * an idempotent confirmation request — no credentials are read from `msg`.
   */
  private handleAuth(client: WsClient): void {
    if (!client.authenticated) {
      this.send(client.ws, { type: 'error', message: 'Unauthorized' });
      client.ws.close(4401, 'Unauthorized');
      return;
    }
    this.sendRegistered(client);
  }

  private handleCallSignal(client: WsClient, msg: any): void {
    if (!client.authenticated) {
      this.send(client.ws, { type: 'error', message: 'Not authenticated' });
      return;
    }

    const target = this.clients.get(msg.target);
    if (!target) {
      this.send(client.ws, { type: 'call_event', event: 'user_offline', target: msg.target });
      return;
    }

    this.send(target.ws, {
      type: 'call_event', event: msg.action,
      from: client.extension, fromName: this.db.getUser(client.extension)?.name,
      data: msg.data,
    });
  }

  /**
   * In-call recording driven entirely over WebSocket (no REST upload).
   *  - start: the caller begins recording locally; notify the peer (consent).
   *  - stop:  the caller stops; notify the peer.
   *  - save:  the caller uploads the finished audio (base64) to be persisted.
   * Media for browser-to-browser calls is peer-to-peer (it never traverses the
   * server), so the actual capture happens client-side via MediaRecorder; the
   * server only coordinates and stores the result.
   */
  private handleRecording(client: WsClient, msg: any): void {
    if (!client.authenticated) {
      this.send(client.ws, { type: 'error', message: 'Not authenticated' });
      return;
    }

    const callId: string = msg.callId || 'unknown';
    const peer = msg.peer ? this.clients.get(msg.peer) : undefined;

    switch (msg.action) {
      case 'start':
        console.log(`⏺️  Recording started by ${client.extension} (call ${callId})`);
        // Tell the other party their call is being recorded (consent/awareness).
        if (peer) this.send(peer.ws, { type: 'call_event', event: 'recording_started', from: client.extension, callId });
        this.send(client.ws, { type: 'recording_event', event: 'started', callId });
        break;

      case 'stop':
        console.log(`⏹️  Recording stopped by ${client.extension} (call ${callId})`);
        if (peer) this.send(peer.ws, { type: 'call_event', event: 'recording_stopped', from: client.extension, callId });
        this.send(client.ws, { type: 'recording_event', event: 'stopped', callId });
        break;

      case 'save':
        this.saveRecording(client, msg);
        break;

      default:
        this.send(client.ws, { type: 'error', message: `Unknown recording action: ${msg.action}` });
    }
  }

  /** Persist a base64-encoded recording uploaded by the client over WS. */
  private saveRecording(client: WsClient, msg: any): void {
    try {
      if (typeof msg.data !== 'string' || !msg.data) {
        this.send(client.ws, { type: 'recording_event', event: 'error', message: 'No audio data' });
        return;
      }
      // Organize as <extension>/<YYYYMMDD>/call_<ts>.<ext> to mirror the
      // voicemail layout and keep recordings grouped per-user/per-day.
      const now = new Date();
      const dateDir = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
      const relDir = `${client.extension}/${dateDir}`;
      const dir = path.resolve(config.callRecording.hostDir, relDir);
      fs.mkdirSync(dir, { recursive: true });

      const ext = String(msg.ext || 'webm').replace(/[^a-z0-9]/gi, '').slice(0, 5) || 'webm';
      const fileName = `call_${Date.now()}.${ext}`;
      const relPath = `${relDir}/${fileName}`;
      const buf = Buffer.from(msg.data, 'base64');
      fs.writeFileSync(path.join(dir, fileName), buf);

      console.log(`💾 Call recording saved: ${relPath} (${Math.round(buf.length / 1024)} KB)`);
      this.send(client.ws, {
        type: 'recording_event', event: 'saved',
        file: relPath, callId: msg.callId, size: buf.length,
      });
    } catch (err: any) {
      console.error('❌ Failed to save recording:', err?.message);
      this.send(client.ws, { type: 'recording_event', event: 'error', message: 'Failed to save recording' });
    }
  }

  private handlePresence(client: WsClient): void {
    const users = this.db.getUsers()
      .filter(u => u.extension !== client.extension)
      .map(u => ({
        extension: u.extension, name: u.name, username: u.username,
        online: this.clients.has(u.extension),
        registered: u.registered,
      }));
    this.send(client.ws, { type: 'online_users', users });
  }

  private broadcastPresence(): void {
    for (const [, c] of this.clients) {
      if (c.authenticated && c.ws.readyState === WebSocket.OPEN) {
        const users = this.db.getUsers()
          .filter(u => u.extension !== c.extension)
          .map(u => ({
            extension: u.extension, name: u.name, username: u.username,
            online: this.clients.has(u.extension),
            registered: u.registered,
          }));
        c.ws.send(JSON.stringify({ type: 'online_users', users }));
      }
    }
  }

  notifyCallEvent(extension: string, event: string, data?: any): void {
    const client = this.clients.get(extension);
    if (client?.authenticated && client.ws.readyState === WebSocket.OPEN) {
      this.send(client.ws, { type: 'call_event', event, ...data });
    }
  }

  private send(ws: WebSocket, data: any): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
  }
}
