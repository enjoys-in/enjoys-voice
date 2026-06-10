import { WebSocketServer as WsServer, WebSocket } from 'ws';
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
      sipWsUrl: `ws://${config.server.publicIp}:${config.sipWs.port}`,
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
