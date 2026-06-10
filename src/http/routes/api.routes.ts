import { Router, Request, Response } from 'express';
import { DatabaseService, TrunkService } from '@/services';
import { SipServer } from '@/sip';
import { config } from '@/core';

export function createRoutes(db: DatabaseService, trunk: TrunkService, sip: SipServer): Router {
  const router = Router();

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
  router.post('/auth', (req: Request, res: Response) => {
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
      user: { extension: user.extension, name: user.name, username: user.username },
      sipConfig: {
        wsUrl: `ws://${config.server.publicIp}:${config.server.wsPort}`,
        sipWsUrl: `ws://${config.server.publicIp}:${config.sipWs.port}`,
        domain: config.server.domain,
        trunkEnabled: trunk.isEnabled,
      },
    });
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

  return router;
}
