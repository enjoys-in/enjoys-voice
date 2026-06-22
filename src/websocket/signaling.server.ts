import { WebSocketServer as WsServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import fs from 'fs';
import path from 'path';
import { config, verifyAccessToken, parseCookies } from '@/core';
import type { JwtClaims } from '@/core';
import { DatabaseService } from '@/services';
import type { MetricsSnapshot, AuditEntry, ConferenceService, QueueService } from '@/services';

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
  // Clients that opted in to live dashboard metrics (admin dashboard). Kept
  // separate from `clients` so normal users never receive metric pushes.
  private metricsSubscribers = new Set<WsClient>();
  private metricsProvider?: () => MetricsSnapshot;
  // Clients watching the live audit feed (admin activity stream). Like the
  // metrics set, kept separate so only opted-in admin dashboards receive pushes.
  private auditSubscribers = new Set<WsClient>();
  private auditProvider?: () => AuditEntry[];
  // Shared conference registry (same instance the SIP path writes joins to).
  // Used to create rooms, send invites and broadcast live rosters.
  private conference?: ConferenceService;
  // Shared call-queue / ACD registry (same instance the SIP path writes to).
  // Used to serve live snapshots and let agents toggle their availability.
  private queue?: QueueService;
  // Clients watching live queue snapshots (supervisor dashboards / agents).
  private queueSubscribers = new Set<WsClient>();

  constructor(private db: DatabaseService) {}

  /** Supply the shared ConferenceService so the socket can orchestrate rooms. */
  setConferenceService(cs: ConferenceService): void {
    this.conference = cs;
  }

  /** Supply the shared QueueService so the socket can serve queue snapshots
   * and toggle agent availability. */
  setQueueService(qs: QueueService): void {
    this.queue = qs;
  }

  /** Supply the current-metrics getter (wired to CallMetricsService). */
  setMetricsProvider(fn: () => MetricsSnapshot): void {
    this.metricsProvider = fn;
  }

  /** Supply the recent-audit-entries getter (wired to AuditService) so a newly
   * subscribed dashboard paints history before live events arrive. */
  setAuditProvider(fn: () => AuditEntry[]): void {
    this.auditProvider = fn;
  }

  start(): void {
    this.wss = new WsServer({
      port: config.server.wsPort,
      path: '/signal',
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
        this.metricsSubscribers.delete(client);
        this.auditSubscribers.delete(client);
        this.queueSubscribers.delete(client);
        this.broadcastPresence();
      });

      ws.on('error', () => {
        if (client.extension) this.clients.delete(client.extension);
        this.metricsSubscribers.delete(client);
        this.auditSubscribers.delete(client);
        this.queueSubscribers.delete(client);
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
      case 'lookup':
        this.handleLookup(client, msg);
        break;
      case 'recording':
        this.handleRecording(client, msg);
        break;
      case 'subscribe_metrics':
        this.handleSubscribeMetrics(client);
        break;
      case 'unsubscribe_metrics':
        this.metricsSubscribers.delete(client);
        break;
      case 'subscribe_audit':
        this.handleSubscribeAudit(client);
        break;
      case 'unsubscribe_audit':
        this.auditSubscribers.delete(client);
        break;
      case 'conference':
        this.handleConference(client, msg);
        break;
      case 'subscribe_queues':
        this.handleSubscribeQueues(client);
        break;
      case 'unsubscribe_queues':
        this.queueSubscribers.delete(client);
        break;
      case 'queue':
        this.handleQueue(client, msg);
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
   * Resolve a dial target (extension/username or phone number) to the callee's
   * saved display name so the caller can show a name instead of a raw number
   * BEFORE the call connects. This covers offline users too — presence only
   * carries names for online peers, so an offline internal contact would
   * otherwise dial as a bare number. Identity-safe: returns only public profile
   * fields (name/mobile), never credentials, and requires an authenticated WS.
   */
  private handleLookup(client: WsClient, msg: any): void {
    if (!client.authenticated) {
      this.send(client.ws, { type: 'error', message: 'Not authenticated' });
      return;
    }
    const target = String(msg.target ?? '').trim();
    if (!target) {
      this.send(client.ws, { type: 'lookup_result', target: '', found: false });
      return;
    }
    // Prefer an extension/username match, then fall back to a phone-number index.
    const user = this.db.getUser(target) ?? this.db.getUserByPhone(target);
    this.send(client.ws, user
      ? { type: 'lookup_result', target, found: true, extension: user.extension, name: user.name, mobile: user.mobile }
      : { type: 'lookup_result', target, found: false });
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

  /**
   * Add an authenticated client to the live-metrics feed and immediately push
   * the current snapshot so the dashboard paints without waiting for the next
   * change/heartbeat.
   */
  private handleSubscribeMetrics(client: WsClient): void {
    if (!client.authenticated) {
      this.send(client.ws, { type: 'error', message: 'Not authenticated' });
      return;
    }
    this.metricsSubscribers.add(client);
    if (this.metricsProvider) {
      this.send(client.ws, { type: 'metrics', ...this.metricsProvider() });
    }
  }

  /** Push a metrics snapshot to every subscribed client (called per change). */
  broadcastMetrics(snapshot: MetricsSnapshot): void {
    for (const client of this.metricsSubscribers) {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(JSON.stringify({ type: 'metrics', ...snapshot }));
      } else {
        this.metricsSubscribers.delete(client);
      }
    }
  }

  /**
   * Add an authenticated client to the live-audit feed and immediately push the
   * recent in-memory entries so the panel paints history before live events.
   */
  private handleSubscribeAudit(client: WsClient): void {
    if (!client.authenticated) {
      this.send(client.ws, { type: 'error', message: 'Not authenticated' });
      return;
    }
    this.auditSubscribers.add(client);
    if (this.auditProvider) {
      this.send(client.ws, { type: 'audit_history', entries: this.auditProvider() });
    }
  }

  /** Push a single audit entry to every subscribed client (called per event). */
  broadcastAuditEntry(entry: AuditEntry): void {
    for (const client of this.auditSubscribers) {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(JSON.stringify({ type: 'audit_entry', entry }));
      } else {
        this.auditSubscribers.delete(client);
      }
    }
  }

  /**
   * Orchestrate multi-party conferences over the signaling socket. The actual
   * audio mixing is done by FreeSWITCH once each browser dials `conf-<roomId>`;
   * this only manages room creation, invitations and the shared roster.
   *
   * Identity is taken from the authenticated connection (`client.extension`),
   * never the message body, so a client can't act as another user. Actions:
   *  - start   {invite: string[], name?}  → create a room hosted by the caller,
   *            invite the listed extensions, and tell the host to dial in.
   *  - invite  {roomId, target}           → add one more invitee to a room the
   *            caller is in.
   *  - decline {roomId}                    → caller declines an invitation.
   *  - leave   {roomId}                    → caller leaves (also covered by the
   *            SIP BYE, but lets a pre-join invitee bow out).
   *  - roster  {roomId}                    → re-send the current roster.
   */
  private handleConference(client: WsClient, msg: any): void {
    if (!client.authenticated) {
      this.send(client.ws, { type: 'error', message: 'Not authenticated' });
      return;
    }
    if (!this.conference) {
      this.send(client.ws, { type: 'conference_event', event: 'error', message: 'Conferencing unavailable' });
      return;
    }

    switch (msg.action) {
      case 'start': {
        const invitees: string[] = Array.isArray(msg.invite)
          ? msg.invite.map((x: any) => String(x).trim()).filter(Boolean)
          : [];
        const hostName = this.db.getUser(client.extension)?.name || client.extension;
        const room = this.conference.createRoom(client.extension, hostName, msg.name);

        // Tell the host to dial into the room (their browser places the SIP call).
        this.send(client.ws, {
          type: 'conference_event', event: 'created',
          roomId: room.id, room: this.conference.snapshot(room.id),
        });

        // Invite everyone else who is a real, distinct user.
        for (const ext of invitees) {
          if (ext === client.extension) continue;
          if (!this.db.getUser(ext)) continue;
          const inviteeName = this.db.getUser(ext)?.name || ext;
          this.conference.addInvite(room.id, ext, inviteeName);
          this.sendConferenceInvite(room.id, room.name, client.extension, hostName, ext);
        }
        break;
      }

      case 'invite': {
        const roomId = String(msg.roomId ?? '').trim();
        const target = String(msg.target ?? '').trim();
        const room = roomId ? this.conference.getRoom(roomId) : undefined;
        if (!room || !target) {
          this.send(client.ws, { type: 'conference_event', event: 'error', message: 'Unknown room or target' });
          return;
        }
        // Only a current member may pull others in.
        if (!room.participants.has(client.extension)) {
          this.send(client.ws, { type: 'conference_event', event: 'error', message: 'Not a member' });
          return;
        }
        if (target === client.extension || !this.db.getUser(target)) return;
        const fromName = this.db.getUser(client.extension)?.name || client.extension;
        const targetName = this.db.getUser(target)?.name || target;
        this.conference.addInvite(roomId, target, targetName);
        this.sendConferenceInvite(roomId, room.name, client.extension, fromName, target);
        break;
      }

      case 'decline': {
        const roomId = String(msg.roomId ?? '').trim();
        if (roomId) this.conference.markLeft(roomId, client.extension);
        break;
      }

      case 'leave': {
        const roomId = String(msg.roomId ?? '').trim();
        if (roomId) this.conference.markLeft(roomId, client.extension);
        break;
      }

      case 'roster': {
        const roomId = String(msg.roomId ?? '').trim();
        const snapshot = roomId ? this.conference.snapshot(roomId) : undefined;
        this.send(client.ws, snapshot
          ? { type: 'conference_event', event: 'roster', roomId, room: snapshot }
          : { type: 'conference_event', event: 'closed', roomId });
        break;
      }

      default:
        this.send(client.ws, { type: 'conference_event', event: 'error', message: `Unknown action: ${msg.action}` });
    }
  }

  /** Send a single conference invitation to an online invitee (if connected). */
  private sendConferenceInvite(
    roomId: string, name: string, fromExt: string, fromName: string, targetExt: string,
  ): void {
    const target = this.clients.get(targetExt);
    if (!target?.authenticated || target.ws.readyState !== WebSocket.OPEN) return;
    this.send(target.ws, {
      type: 'conference_event', event: 'invited',
      roomId, name, from: fromExt, fromName,
    });
  }

  /**
   * Push the current roster to every participant of a room (called on any
   * change via the ConferenceService 'updated' event). Offline/never-joined
   * invitees are simply skipped.
   */
  broadcastConferenceRoster(roomId: string): void {
    if (!this.conference) return;
    const room = this.conference.getRoom(roomId);
    const snapshot = this.conference.snapshot(roomId);
    if (!room || !snapshot) return;
    for (const ext of room.participants.keys()) {
      const client = this.clients.get(ext);
      if (client?.authenticated && client.ws.readyState === WebSocket.OPEN) {
        this.send(client.ws, { type: 'conference_event', event: 'roster', roomId, room: snapshot });
      }
    }
  }

  /** Tell a room's participants it has ended so their UIs can tear down. */
  broadcastConferenceClosed(roomId: string, participants?: string[]): void {
    const targets = participants ?? Array.from(this.clients.keys());
    for (const ext of targets) {
      const client = this.clients.get(ext);
      if (client?.authenticated && client.ws.readyState === WebSocket.OPEN) {
        this.send(client.ws, { type: 'conference_event', event: 'closed', roomId });
      }
    }
  }

  /**
   * Subscribe a client to live queue snapshots (supervisor dashboard or an
   * agent watching their own queues) and paint the current state immediately.
   * Any authenticated user may watch; pushes are read-only.
   */
  private handleSubscribeQueues(client: WsClient): void {
    if (!client.authenticated) {
      this.send(client.ws, { type: 'error', message: 'Not authenticated' });
      return;
    }
    if (!this.queue) {
      this.send(client.ws, { type: 'queue_event', event: 'error', message: 'Queues unavailable' });
      return;
    }
    this.queueSubscribers.add(client);
    this.send(client.ws, { type: 'queue_event', event: 'snapshot', queues: this.queue.snapshotAll() });
  }

  /**
   * Handle an agent action on a queue. Identity is taken from the authenticated
   * connection (never the message body), so an agent can only pause/unpause
   * themselves. `queueId` scopes the change to one queue; omit it to toggle the
   * agent across every queue they belong to.
   */
  private handleQueue(client: WsClient, msg: any): void {
    if (!client.authenticated) {
      this.send(client.ws, { type: 'error', message: 'Not authenticated' });
      return;
    }
    if (!this.queue) {
      this.send(client.ws, { type: 'queue_event', event: 'error', message: 'Queues unavailable' });
      return;
    }

    const ext = client.extension;
    switch (msg.action) {
      case 'pause':
      case 'unpause': {
        const paused = msg.action === 'pause';
        const queueId = msg.queueId ? String(msg.queueId).trim() : '';
        const changed = queueId
          ? (this.queue.setAgentPaused(queueId, ext, paused) ? [queueId] : [])
          : this.queue.setAgentPausedAll(ext, paused);
        this.send(client.ws, {
          type: 'queue_event', event: 'agent_state',
          extension: ext, paused, queues: changed,
        });
        break;
      }

      case 'snapshot': {
        const queueId = msg.queueId ? String(msg.queueId).trim() : '';
        if (queueId) {
          const snapshot = this.queue.snapshot(queueId);
          this.send(client.ws, snapshot
            ? { type: 'queue_event', event: 'queue', queueId, queue: snapshot }
            : { type: 'queue_event', event: 'error', message: 'Unknown queue' });
        } else {
          this.send(client.ws, { type: 'queue_event', event: 'snapshot', queues: this.queue.snapshotAll() });
        }
        break;
      }

      default:
        this.send(client.ws, { type: 'queue_event', event: 'error', message: `Unknown action: ${msg.action}` });
    }
  }

  /**
   * Push the latest snapshot of one queue to every subscribed client (called on
   * any change via the QueueService 'updated' event).
   */
  broadcastQueueSnapshot(queueId: string): void {
    if (!this.queue || this.queueSubscribers.size === 0) return;
    const snapshot = this.queue.snapshot(queueId);
    if (!snapshot) return;
    const payload = { type: 'queue_event', event: 'queue', queueId, queue: snapshot };
    for (const client of this.queueSubscribers) {
      if (client.authenticated && client.ws.readyState === WebSocket.OPEN) {
        this.send(client.ws, payload);
      }
    }
  }

  private send(ws: WebSocket, data: any): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
  }
}