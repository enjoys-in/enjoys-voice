import { Router, Request, Response } from 'express';
import { DatabaseService, TrunkService, AuditService } from '@/services';
import type { AuditEvent } from '@/services';
import { SipServer } from '@/sip';
import { config } from '@/core';
import { authRateLimit } from '../middleware/rate-limit';

export function createRoutes(db: DatabaseService, trunk: TrunkService, sip: SipServer, audit: AuditService): Router {
  const router = Router();

  // Build the SIP config returned to clients. In production set PUBLIC_WS_URL /
  // PUBLIC_SIP_WS_URL (e.g. wss://voice.example.com/...) to use a TLS proxy;
  // otherwise legacy ws://<publicIp>:<port> URLs are used (local default).
  const buildSipConfig = () => ({
    wsUrl: config.server.publicWsUrl || `ws://${config.server.publicIp}:${config.server.wsPort}`,
    sipWsUrl: config.server.publicSipWsUrl || `ws://${config.server.publicIp}:${config.sipWs.port}`,
    domain: config.server.domain,
    trunkEnabled: trunk.isEnabled,
  });

  // ─── Health ──────────────────────────────────────────
  router.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      sipConnected: sip.isConnected,
      ivrActive: sip.ivrSystem?.isConnected() ?? false,
      trunkEnabled: trunk.isEnabled,
      uptime: process.uptime(),
    });
  });

  // ─── Auth ────────────────────────────────────────────
  router.post('/auth', authRateLimit, (req: Request, res: Response) => {
    const { username, password } = req.body;
    if (!username || !password) {
      res.status(400).json({ error: 'Missing credentials' });
      return;
    }

    const user = db.authenticate(username, password);
    if (!user) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    res.json({
      success: true,
      user: { extension: user.extension, name: user.name, username: user.username, mobile: user.mobile },
      sipConfig: buildSipConfig(),
    });
  });

  // ─── Signup ──────────────────────────────────────────
  router.post('/auth/signup', authRateLimit, (req: Request, res: Response) => {
    const { name, mobile, password } = req.body;
    if (!name || !mobile || !password) {
      res.status(400).json({ error: 'Missing fields: name, mobile, password required' });
      return;
    }

    const normalized = mobile.replace(/\D/g, '');
    if (normalized.length < 7) {
      res.status(400).json({ error: 'Invalid phone number (min 7 digits)' });
      return;
    }

    const user = db.signup(name, mobile, password);
    if (!user) {
      res.status(409).json({ error: 'Phone number already registered' });
      return;
    }

    res.status(201).json({
      success: true,
      user: { extension: user.extension, name: user.name, username: user.username, mobile: user.mobile },
      sipConfig: buildSipConfig(),
    });
  });

  // ─── Lookup by phone ────────────────────────────────
  router.get('/lookup/:phone', (req: Request, res: Response) => {
    const user = db.getUserByPhone(req.params.phone);
    if (!user) { res.status(404).json({ error: 'Not found' }); return; }
    res.json({ extension: user.extension, name: user.name, mobile: user.mobile });
  });

  // ─── Users ───────────────────────────────────────────
  router.get('/users', (_req: Request, res: Response) => {
    res.json(db.getUsers().map(u => ({
      extension: u.extension, name: u.name,
      username: u.username, registered: u.registered,
    })));
  });

  router.get('/users/:ext', (req: Request, res: Response) => {
    const user = db.getUser(req.params.ext);
    if (!user) { res.status(404).json({ error: 'Not found' }); return; }
    res.json({ extension: user.extension, name: user.name, registered: user.registered });
  });

  // ─── Calls ──────────────────────────────────────────
  router.get('/calls', (_req: Request, res: Response) => {
    res.json(db.getCalls());
  });

  router.get('/calls/:ext', (req: Request, res: Response) => {
    res.json(db.getCallsByUser(req.params.ext));
  });

  // ─── IVR ────────────────────────────────────────────
  router.get('/ivr/status', (_req: Request, res: Response) => {
    const ivr = sip.ivrSystem;
    res.json({
      enabled: config.ivr.enabled,
      connected: ivr?.isConnected() ?? false,
      activeCalls: ivr?.getActiveCalls() ?? [],
      departments: ivr?.getDepartments() ?? [],
    });
  });

  router.get('/ivr/recordings', (_req: Request, res: Response) => {
    res.json(sip.ivrSystem?.getRecordings() ?? []);
  });

  router.post('/ivr/transfer', (req: Request, res: Response) => {
    const { callId, targetExtension, attended } = req.body;
    const ivr = sip.ivrSystem;
    if (!ivr) { res.status(503).json({ error: 'IVR not available' }); return; }
    ivr.transferCall(callId, targetExtension, !!attended)
      .then(ok => res.json({ success: ok }))
      .catch(() => res.status(500).json({ error: 'Transfer failed' }));
  });

  // ─── Trunk ──────────────────────────────────────────
  router.get('/trunk', (_req: Request, res: Response) => {
    const info = trunk.getActive();
    if (!info) { res.json({ enabled: false }); return; }
    res.json({ enabled: true, name: info.name, host: info.host, transport: info.transport });
  });

  // ─── Config ─────────────────────────────────────────
  router.get('/config', (_req: Request, res: Response) => {
    res.json({
      domain: config.server.domain,
      sipWsPort: config.sipWs.port,
      wsPort: config.server.wsPort,
      ivrEnabled: config.ivr.enabled,
      ivrEntry: config.ivr.entryExtension,
    });
  });

  // ─── Block List ─────────────────────────────────────
  router.get('/block/:ext', (req: Request, res: Response) => {
    res.json({ blocked: db.getBlockedNumbers(req.params.ext) });
  });

  router.post('/block/:ext', (req: Request, res: Response) => {
    const { number } = req.body;
    if (!number) { res.status(400).json({ error: 'Missing number' }); return; }
    const ok = db.blockNumber(req.params.ext, number);
    res.json({ success: ok });
  });

  router.delete('/block/:ext/:number', (req: Request, res: Response) => {
    const ok = db.unblockNumber(req.params.ext, req.params.number);
    res.json({ success: ok });
  });

  // ─── Call Forwarding ────────────────────────────────
  router.get('/forwarding/:ext', (req: Request, res: Response) => {
    res.json(db.getForwarding(req.params.ext));
  });

  router.post('/forwarding/:ext', (req: Request, res: Response) => {
    const { type, target } = req.body;
    if (!type || !['busy', 'noAnswer', 'unavailable'].includes(type)) {
      res.status(400).json({ error: 'Invalid type (busy | noAnswer | unavailable)' });
      return;
    }
    const ok = db.setForwarding(req.params.ext, type, target || null);
    res.json({ success: ok });
  });

  // ─── Audit Log ──────────────────────────────────────
  router.get('/audit', (req: Request, res: Response) => {
    const { user, event, from, to, limit } = req.query;
    const entries = audit.query({
      user: user as string | undefined,
      event: event as AuditEvent | undefined,
      from: from as string | undefined,
      to: to as string | undefined,
      limit: limit ? parseInt(limit as string, 10) : undefined,
    });
    res.json(entries);
  });

  router.get('/audit/:ext', (req: Request, res: Response) => {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
    res.json(audit.getByExtension(req.params.ext, limit));
  });

  // ─── PSTN Forward to Browser ────────────────────────
  router.get('/pstn-forward/:ext', (req: Request, res: Response) => {
    res.json(db.getPstnForward(req.params.ext));
  });

  router.post('/pstn-forward/:ext', (req: Request, res: Response) => {
    const { enabled, target } = req.body;
    if (typeof enabled !== 'boolean') {
      res.status(400).json({ error: 'Missing boolean field: enabled' });
      return;
    }
    const ok = db.setPstnForward(req.params.ext, enabled, target || undefined);
    res.json({ success: ok });
  });

  return router;
}
