import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { DatabaseService, TrunkService } from '@/services';
import type { CallMetricsService, ApiKeyService, ApiKeyDenyReason } from '@/services';
import { SipServer } from '@/sip';
import type { ITrunkProvider, MediaStreamTrack } from '@/trunk';
import { config, signWidgetToken, WIDGET_TOKEN_TTL_SECONDS, buildIceServers } from '@/core';
import { requireAuth, requireSelfExtension } from '../middleware/auth';
import { ok, created, fail } from '../response';

export function createRoutes(
  db: DatabaseService,
  trunk: TrunkService,
  sip: SipServer,
  trunkProvider?: ITrunkProvider,
  metrics?: CallMetricsService,
  apiKeys?: ApiKeyService,
): Router {
  const router = Router();

  // ─── Health ──────────────────────────────────────────
  router.get('/health', (_req: Request, res: Response) => {
    ok(res, {
      status: 'ok',
      sipConnected: sip.isConnected,
      ivrActive: sip.ivrSystem?.isConnected() ?? false,
      trunkEnabled: trunk.isEnabled,
      uptime: process.uptime(),
    });
  });

  // ─── Live metrics ────────────────────────────────────
  // Real-time call concurrency / CPS snapshot for the admin dashboard. The same
  // data streams over the signaling WS (`metrics` event); this REST route gives
  // the dashboard its first paint and a non-WS fallback. Auth-guarded since it
  // exposes system-wide call activity.
  router.get('/metrics', requireAuth, (_req: Request, res: Response) => {
    if (!metrics) { fail(res, 503, 'Metrics not available'); return; }
    ok(res, metrics.getSnapshot());
  });

  // The Go API (/api/g) is the system of record for persistent, per-user CRUD
  // and owns these routes exclusively — Node deliberately exposes none of them:
  //   auth/*, lookup, block, forwarding, pstn-forward, settings, sounds,
  //   ivr/flows, audit, calls
  // Node (/api/n) keeps only routes backed by a LIVE engine service it alone
  // knows: health, ivr status/recordings/transfer, trunk, config, plus user
  // presence (registered) and voicemail audio streaming. Node remains the sole
  // WRITER of call history into the shared call_records table; Go only reads it.

  // ─── Users ───────────────────────────────────────────
  router.get('/users', (_req: Request, res: Response) => {
    ok(res, db.getUsers().map(u => ({
      extension: u.extension, name: u.name,
      username: u.username, registered: u.registered,
    })));
  });

  router.get('/users/:ext', (req: Request, res: Response) => {
    const user = db.getUser(req.params.ext);
    if (!user) { fail(res, 404, 'Not found'); return; }
    ok(res, { extension: user.extension, name: user.name, registered: user.registered });
  });

  // ─── IVR ────────────────────────────────────────────
  router.get('/ivr/status', (_req: Request, res: Response) => {
    const ivr = sip.ivrSystem;
    ok(res, {
      enabled: config.ivr.enabled,
      connected: ivr?.isConnected() ?? false,
      activeCalls: ivr?.getActiveCalls() ?? [],
      departments: ivr?.getDepartments() ?? [],
    });
  });

  router.get('/ivr/recordings', (_req: Request, res: Response) => {
    ok(res, sip.ivrSystem?.getRecordings() ?? []);
  });

  router.post('/ivr/transfer', (req: Request, res: Response) => {
    const { callId, targetExtension, attended } = req.body;
    const ivr = sip.ivrSystem;
    if (!ivr) { fail(res, 503, 'IVR not available'); return; }
    ivr.transferCall(callId, targetExtension, !!attended)
      .then(transferred => ok(res, { success: transferred }))
      .catch(() => fail(res, 500, 'Transfer failed'));
  });

  // ─── Trunk ──────────────────────────────────────────
  router.get('/trunk', (_req: Request, res: Response) => {
    const info = trunk.getActive();
    if (!info) { ok(res, { enabled: false }); return; }
    ok(res, { enabled: true, name: info.name, host: info.host, transport: info.transport });
  });

  // ─── Twilio trunk (REST Voice API) ───────────────────
  // Provider-backed PSTN via Twilio's Programmable Voice API, distinct from the
  // legacy SIP trunk above. Originating a call places a REAL, billable PSTN call,
  // so the action routes require a valid access token (requireAuth).
  router.get('/trunk/twilio', (_req: Request, res: Response) => {
    ok(res, { enabled: trunkProvider?.isEnabled ?? false });
  });

  router.post('/trunk/twilio/originate', requireAuth, async (req: Request, res: Response) => {
    if (!trunkProvider?.isEnabled) {
      fail(res, 503, 'Twilio trunk not enabled');
      return;
    }
    const { to, from, answerUrl, twiml } = (req.body ?? {}) as {
      to?: string; from?: string; answerUrl?: string; twiml?: string;
    };
    if (!to || typeof to !== 'string') {
      fail(res, 400, 'Missing or invalid `to`');
      return;
    }
    if (!answerUrl && !twiml) {
      fail(res, 400, 'Provide `answerUrl` or `twiml`');
      return;
    }
    try {
      const result = await trunkProvider.originateCall({ to, from, answerUrl, instructions: twiml });
      created(res, { id: result.id, status: result.status });
    } catch (err: any) {
      fail(res, 502, err?.message ?? 'Originate failed');
    }
  });

  // Start a Media Stream on an ACTIVE Twilio call (forks audio to your wss URL).
  // REST-started Twilio streams are unidirectional; two-way audio needs
  // <Connect><Stream> TwiML at answer time instead.
  router.post('/trunk/twilio/stream', requireAuth, async (req: Request, res: Response) => {
    if (!trunkProvider?.isEnabled) {
      fail(res, 503, 'Twilio trunk not enabled');
      return;
    }
    const { callId, wsUrl, track, name } = (req.body ?? {}) as {
      callId?: string; wsUrl?: string; track?: MediaStreamTrack; name?: string;
    };
    if (!callId || typeof callId !== 'string') {
      fail(res, 400, 'Missing or invalid `callId`');
      return;
    }
    if (!wsUrl || !wsUrl.startsWith('wss://')) {
      fail(res, 400, '`wsUrl` must be a secure wss:// URL');
      return;
    }
    try {
      const result = await trunkProvider.startMediaStream(callId, { wsUrl, track, name });
      created(res, { id: result.id, status: result.status });
    } catch (err: any) {
      fail(res, 502, err?.message ?? 'Stream start failed');
    }
  });

  // ─── Config ─────────────────────────────────────────
  router.get('/config', (_req: Request, res: Response) => {
    ok(res, {
      domain: config.server.domain,
      sipWsPort: config.sipWs.port,
      wsPort: config.server.wsPort,
      ivrEnabled: config.ivr.enabled,
      ivrEntry: config.ivr.entryExtension,
    });
  });

  // ─── Voicemail ───────────────────────────────────────
  // Per-user and JWT-protected, mirroring the Go API's protected group: every
  // route requires a valid access token AND the caller may only touch their own
  // mailbox (:ext must equal the token's extension). Mounted as a sub-router so
  // the guards apply once; mergeParams exposes :ext / :id from the mount path.
  const vm = Router({ mergeParams: true });
  vm.use(requireAuth, requireSelfExtension);

  vm.get('/', async (req: Request, res: Response) => {
    try {
      const { voicemails, unread } = await db.getVoicemailsWithUnread(req.params.ext);
      ok(res, { voicemails, unread });
    } catch {
      fail(res, 500, 'Failed to load voicemails');
    }
  });

  vm.get('/:id/audio', async (req: Request, res: Response) => {
    try {
      const voicemail = await db.getVoicemail(req.params.ext, req.params.id);
      if (!voicemail) {
        fail(res, 404, 'Voicemail not found');
        return;
      }
      const filePath = path.resolve(config.voicemail.hostDir, voicemail.file);
      if (!fs.existsSync(filePath)) {
        fail(res, 404, 'Recording file missing');
        return;
      }
      res.setHeader('Content-Type', 'audio/wav');
      res.setHeader('Accept-Ranges', 'bytes');
      fs.createReadStream(filePath).pipe(res);
    } catch {
      fail(res, 500, 'Failed to stream voicemail');
    }
  });

  vm.post('/:id/read', async (req: Request, res: Response) => {
    try {
      const marked = await db.markVoicemailRead(req.params.ext, req.params.id);
      const unread = await db.unreadVoicemailCount(req.params.ext);
      ok(res, { success: marked, unread });
    } catch {
      fail(res, 500, 'Failed to update voicemail');
    }
  });

  vm.delete('/:id', async (req: Request, res: Response) => {
    try {
      // Single DELETE ... RETURNING filename: removes the row AND hands back the
      // file to unlink, so no separate SELECT is needed. undefined => no such row.
      const filename = await db.deleteVoicemail(req.params.ext, req.params.id);
      if (filename) {
        try { fs.unlinkSync(path.resolve(config.voicemail.hostDir, filename)); } catch { /* noop */ }
      }
      ok(res, { success: !!filename });
    } catch {
      fail(res, 500, 'Failed to delete voicemail');
    }
  });

  router.use('/voicemails/:ext', vm);

  // ─── Click-to-call widget (developer API) ────────────
  // Public, key-gated endpoints the embeddable widget / npm package call from a
  // visitor's browser. No dashboard JWT here — auth IS the publishable API key
  // (pk_live_…), bound to allowed Origins + client IPs and enforced per request.
  //   POST /widget/config   → validate key+origin+ip; return display/connect
  //                           config (no token) so the widget can decide whether
  //                           to render or surface an error.
  //   POST /widget/session  → same validation, then mint a short-lived capability
  //                           token (type:'widget') the SIP.js client sends in the
  //                           X-Widget-Token header of its INVITE.
  //   POST /widget/token    → server-to-server: authenticate with the SECRET key
  //                           (Authorization: Bearer sk_live_…) to mint a token
  //                           without Origin/IP limits (trusted backend caller).
  //   POST /widget/callback → server-to-server (Authorization: Bearer sk_live_…):
  //                           true PSTN↔PSTN callback. No browser/token: we dial
  //                           the key's LOCKED destination, then the supplied
  //                           customerNumber, and bridge them via FreeSWITCH.
  const widget = Router();

  // Pull the publishable key (JSON body or X-Api-Key header) plus the caller's
  // Origin and real client IP. req.ip is trustworthy because http.server.ts sets
  // `trust proxy` so X-Forwarded-For from Caddy is honored.
  const widgetMeta = (req: Request): { key: string; origin: string; ip: string } => {
    const body = (req.body ?? {}) as { publicKey?: unknown; key?: unknown };
    const fromBody =
      (typeof body.publicKey === 'string' && body.publicKey) ||
      (typeof body.key === 'string' && body.key) ||
      '';
    const key = (fromBody || req.get('x-api-key') || '').trim();
    return { key, origin: req.get('origin') || '', ip: req.ip || req.socket.remoteAddress || '' };
  };

  // Map an ApiKeyService deny reason to an HTTP status + message.
  const widgetDeny = (reason: ApiKeyDenyReason): { status: number; message: string } => {
    switch (reason) {
      case 'not_found': return { status: 404, message: 'Unknown API key' };
      case 'inactive': return { status: 403, message: 'API key is disabled' };
      case 'origin_not_allowed': return { status: 403, message: 'Origin not allowed for this API key' };
      case 'ip_not_allowed': return { status: 403, message: 'Client IP not allowed for this API key' };
      case 'daily_cap_reached': return { status: 429, message: 'Daily call cap reached' };
      case 'bad_secret': return { status: 401, message: 'Invalid API secret' };
      default: return { status: 403, message: 'API key validation failed' };
    }
  };

  // Connect config every widget response shares (where/how to reach the SIP-WS).
  // iceServers are built per-request so ephemeral TURN credentials (when the
  // TURN_STATIC_AUTH_SECRET secret is set) are freshly minted for each client.
  const widgetConnect = () => ({
    sipWsUrl: config.widget.sipWsUrl,
    domain: config.server.domain,
    iceServers: buildIceServers(),
  });

  widget.post('/config', async (req: Request, res: Response) => {
    if (!apiKeys || !config.widget.enabled) { fail(res, 503, 'Widget not available'); return; }
    const { key, origin, ip } = widgetMeta(req);
    if (!key) { fail(res, 400, 'publicKey is required'); return; }
    const result = await apiKeys.validate(key, origin, ip);
    if (!result.ok) { const d = widgetDeny(result.reason); fail(res, d.status, d.message); return; }
    ok(res, {
      destination: result.key.destination,
      label: result.key.label,
      callerId: result.key.callerId,
      ...widgetConnect(),
    });
  });

  widget.post('/session', async (req: Request, res: Response) => {
    if (!apiKeys || !config.widget.enabled) { fail(res, 503, 'Widget not available'); return; }
    const { key, origin, ip } = widgetMeta(req);
    if (!key) { fail(res, 400, 'publicKey is required'); return; }
    const result = await apiKeys.validate(key, origin, ip);
    if (!result.ok) { const d = widgetDeny(result.reason); fail(res, d.status, d.message); return; }
    // Count this as a call attempt against the (optional) daily cap, then mint a
    // capability token scoped to exactly this key's destination + caller-ID.
    apiKeys.noteCall(result.key.id, result.key.dailyCap);
    const token = signWidgetToken({
      keyId: result.key.id,
      owner: result.key.owner,
      destination: result.key.destination,
      callerId: result.key.callerId,
      routeType: result.key.routeType,
    });
    created(res, {
      token,
      expiresIn: WIDGET_TOKEN_TTL_SECONDS,
      destination: result.key.destination,
      callerId: result.key.callerId,
      ...widgetConnect(),
    });
  });

  widget.post('/token', async (req: Request, res: Response) => {
    if (!apiKeys || !config.widget.enabled) { fail(res, 503, 'Widget not available'); return; }
    const { key } = widgetMeta(req);
    const auth = req.get('authorization') || '';
    const secret = /^bearer /i.test(auth) ? auth.slice(7).trim() : '';
    if (!key || !secret) { fail(res, 400, 'publicKey and a Bearer secret are required'); return; }
    const result = await apiKeys.verifySecret(key, secret);
    if (!result.ok) { const d = widgetDeny(result.reason); fail(res, d.status, d.message); return; }
    apiKeys.noteCall(result.key.id, result.key.dailyCap);
    const token = signWidgetToken({
      keyId: result.key.id,
      owner: result.key.owner,
      destination: result.key.destination,
      callerId: result.key.callerId,
      routeType: result.key.routeType,
    });
    created(res, {
      token,
      expiresIn: WIDGET_TOKEN_TTL_SECONDS,
      destination: result.key.destination,
      callerId: result.key.callerId,
      ...widgetConnect(),
    });
  });

  // Server-to-server PSTN↔PSTN callback. Authenticated with the SECRET key only
  // (no Origin/IP gate — the secret IS the auth), this dials the key's locked
  // destination and the caller-supplied customerNumber and bridges them through
  // FreeSWITCH. Two PSTN legs are billable, so the per-key daily cap is enforced
  // here exactly as the browser path enforces it. The bridge rings for many
  // seconds, so we validate synchronously then originate in the background and
  // return 202-style { callId, status:'originating' } immediately.
  widget.post('/callback', async (req: Request, res: Response) => {
    if (!apiKeys || !config.widget.enabled) { fail(res, 503, 'Widget not available'); return; }
    const { key } = widgetMeta(req);
    const auth = req.get('authorization') || '';
    const secret = /^bearer /i.test(auth) ? auth.slice(7).trim() : '';
    const body = (req.body ?? {}) as { customerNumber?: unknown; to?: unknown };
    const rawTo =
      (typeof body.customerNumber === 'string' && body.customerNumber) ||
      (typeof body.to === 'string' && body.to) || '';
    if (!key || !secret) { fail(res, 400, 'publicKey and a Bearer secret are required'); return; }
    if (!rawTo) { fail(res, 400, 'customerNumber is required'); return; }

    const result = await apiKeys.verifySecret(key, secret);
    if (!result.ok) { const d = widgetDeny(result.reason); fail(res, d.status, d.message); return; }
    const apiKey = result.key;

    // A PSTN↔PSTN callback only makes sense for a trunk-routed key; ivr/extension
    // keys resolve to internal targets that have no second PSTN leg to bridge.
    if (apiKey.routeType !== 'trunk') { fail(res, 400, 'Callback bridge requires a trunk-routed key'); return; }
    if (!trunk.isEnabled) { fail(res, 503, 'Outbound trunk not available'); return; }

    // Sanitize the visitor's number (the destination is locked server-side and
    // never taken from the request, so only this leg needs validation).
    const customerNumber = rawTo.replace(/[^\d+]/g, '');
    if (!/^\+?\d{6,15}$/.test(customerNumber)) { fail(res, 400, 'Invalid customerNumber'); return; }

    if (apiKeys.capReached(apiKey)) { fail(res, 429, 'Daily call cap reached'); return; }

    const ivr = sip.ivrSystem;
    if (!ivr || !ivr.isConnected()) { fail(res, 503, 'Media server not available'); return; }

    // Count the attempt against the daily cap up-front, then originate both legs
    // in the background — the API answers right away with a tracking id.
    apiKeys.noteCall(apiKey.id, apiKey.dailyCap);
    const callId = crypto.randomUUID();
    console.log(`📞 Callback: key=${apiKey.publicKey} ${apiKey.destination} ↔ ${customerNumber} (callId=${callId})`);

    void ivr.bridgePstnToPstn(trunk, apiKey.destination, customerNumber, { callerId: apiKey.callerId })
      .then((r) => { if (!r.ok) console.warn(`⚠️ Callback ${callId} failed: ${r.reason}`); })
      .catch((err) => console.error(`❌ Callback ${callId} error:`, err?.message || err));

    created(res, {
      callId,
      status: 'originating',
      destination: apiKey.destination,
      customerNumber,
      callerId: apiKey.callerId,
    });
  });

  router.use('/widget', widget);

  return router;
}
