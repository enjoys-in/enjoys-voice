import { WebSocketServer as WsServer, WebSocket } from 'ws';
import fs from 'fs';
import path from 'path';
import { config } from '@/core';
import { DatabaseService } from '@/services';

interface WsClient {
  ws: WebSocket;
  extension: string;
  username: string;
  authenticated: boolean;
}

export class SignalingServer {
  private wss!: WsServer;
  private clients = new Map<string, WsClient>();

  constructor(private db: DatabaseService) {}

  start(): void {
    this.wss = new WsServer({ port: config.server.wsPort });

    this.wss.on('listening', () => {
      console.log(`✅ WS: Signaling server on port ${config.server.wsPort}`);
    });

    this.wss.on('connection', (ws: WebSocket) => {
      let client: WsClient = { ws, extension: '', username: '', authenticated: false };

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

  private handleMessage(client: WsClient, msg: any): void {
    switch (msg.type) {
      case 'auth':
      case 'register':
        this.handleAuth(client, msg);
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

  private handleAuth(client: WsClient, msg: any): void {
    const user = this.db.authenticate(msg.username, msg.password);
    if (!user) {
      this.send(client.ws, { type: 'error', message: 'Invalid credentials' });
      return;
    }

    client.authenticated = true;
    client.extension = user.extension;
    client.username = user.username;
    this.clients.set(user.extension, client);

    this.send(client.ws, {
      type: 'registered',
      user: { extension: user.extension, name: user.name, username: user.username },
      sipWsUrl: config.server.publicSipWsUrl || `ws://${config.server.publicIp}:${config.sipWs.port}`,
    });

    this.broadcastPresence();
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
