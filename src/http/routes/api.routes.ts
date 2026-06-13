import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
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

  // ─── Voicemail ───────────────────────────────────────
  router.get('/voicemails/:ext', async (req: Request, res: Response) => {
    try {
      const [voicemails, unread] = await Promise.all([
        db.getVoicemails(req.params.ext),
        db.unreadVoicemailCount(req.params.ext),
      ]);
      res.json({ voicemails, unread });
    } catch {
      res.status(500).json({ error: 'Failed to load voicemails' });
    }
  });

  router.get('/voicemails/:ext/:id/audio', async (req: Request, res: Response) => {
    try {
      const vm = await db.getVoicemail(req.params.ext, req.params.id);
      if (!vm) {
        res.status(404).json({ error: 'Voicemail not found' });
        return;
      }
      const filePath = path.resolve(config.voicemail.hostDir, vm.file);
      if (!fs.existsSync(filePath)) {
        res.status(404).json({ error: 'Recording file missing' });
        return;
      }
      res.setHeader('Content-Type', 'audio/wav');
      res.setHeader('Accept-Ranges', 'bytes');
      fs.createReadStream(filePath).pipe(res);
    } catch {
      res.status(500).json({ error: 'Failed to stream voicemail' });
    }
  });

  router.post('/voicemails/:ext/:id/read', async (req: Request, res: Response) => {
    try {
      const ok = await db.markVoicemailRead(req.params.ext, req.params.id);
      const unread = await db.unreadVoicemailCount(req.params.ext);
      res.json({ success: ok, unread });
    } catch {
      res.status(500).json({ error: 'Failed to update voicemail' });
    }
  });

  router.delete('/voicemails/:ext/:id', async (req: Request, res: Response) => {
    try {
      const vm = await db.getVoicemail(req.params.ext, req.params.id);
      const ok = await db.deleteVoicemail(req.params.ext, req.params.id);
      // Best-effort cleanup of the audio file.
      if (ok && vm) {
        try { fs.unlinkSync(path.resolve(config.voicemail.hostDir, vm.file)); } catch { /* noop */ }
      }
      res.json({ success: ok });
    } catch {
      res.status(500).json({ error: 'Failed to delete voicemail' });
    }
  });

  return router;
}
