import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { DatabaseService, TrunkService } from '@/services';
import { SipServer } from '@/sip';
import type { ITrunkProvider, MediaStreamTrack } from '@/trunk';
import { config } from '@/core';
import { requireAuth, requireSelfExtension } from '../middleware/auth';
import { ok, created, fail } from '../response';

export function createRoutes(
  db: DatabaseService,
  trunk: TrunkService,
  sip: SipServer,
  trunkProvider?: ITrunkProvider,
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

  return router;
}
