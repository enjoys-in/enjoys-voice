import Srf from 'drachtio-srf';
import crypto from 'crypto';
import { config } from '@/core';
import { SipStatus } from '@/core/types';
import { DatabaseService, TrunkService, AuditService, DialPlanService } from '@/services';
import type { RegistrationStore } from '@/services/registration';
import { IVRSystem } from './ivr.system';
import {
  TrunkInboundHandler, EmergencyHandler, IvrHandler,
  InternalHandler, ExternalHandler,
  type RouteHandler, type CallContext, type RouteServices,
} from './routes';

export class SipServer {
  private srf: InstanceType<typeof Srf>;
  private connected = false;
  private ivr: IVRSystem | null = null;
  private notifyFn?: (extension: string, event: string, data?: any) => void;
  private dialPlan = new DialPlanService();
  /** SIP rate limiter: tracks REGISTER/INVITE per IP */
  private sipRateMap = new Map<string, { count: number; resetAt: number }>();
  private readonly SIP_RATE_LIMIT = 30; // per minute per IP
  private readonly SIP_RATE_WINDOW = 60_000;

  // ─── Route Handlers (ordered by priority) ────────────
  private routeHandlers: RouteHandler[] = [
    new TrunkInboundHandler(),
    new EmergencyHandler(),
    new IvrHandler(),
    new InternalHandler(),
    new ExternalHandler(),
  ];

  constructor(
    private db: DatabaseService,
    private trunk: TrunkService,
    private registrationStore: RegistrationStore,
    private audit: AuditService,
  ) {
    this.srf = new Srf();
    // Pre-bind to avoid allocating new functions on every INVITE
    this.boundRouteToExtension = this.routeToExtension.bind(this);
    this.boundForwardCall = this.forwardCall.bind(this);
    this.boundRouteUnreachable = this.routeUnreachable.bind(this);
  }

  private readonly boundRouteToExtension: RouteServices['routeToExtension'];
  private readonly boundForwardCall: RouteServices['forwardCall'];
  private readonly boundRouteUnreachable: RouteServices['routeUnreachable'];

  /** Register a callback to notify users of call events via WebSocket */
  setNotifier(fn: (extension: string, event: string, data?: any) => void): void {
    this.notifyFn = fn;
    this.ivr?.setNotifier(fn);
  }

  /** Check SIP rate limit per source IP. Returns true if allowed. */
  private checkSipRate(ip: string): boolean {
    const now = Date.now();
    const entry = this.sipRateMap.get(ip);
    if (!entry || now > entry.resetAt) {
      this.sipRateMap.set(ip, { count: 1, resetAt: now + this.SIP_RATE_WINDOW });
      return true;
    }
    entry.count++;
    return entry.count <= this.SIP_RATE_LIMIT;
  }

  async start(): Promise<void> {
    this.registerHandlers();

    this.srf.connect(config.drachtio);
 
    this.srf.on('connect', (_err: any, hp: string) => {
      this.connected = true;
      console.log(`✅ SIP: Connected to drachtio (${hp})`);
      console.log(`   Registered handlers: register, invite, options, info, message`);
      // Defer IVR init to next tick to avoid blocking the connect handler
      setTimeout(() => this.initIvr(), 500);
    });

    this.srf.on('error', (err: any) => {
      this.connected = false;
      console.warn('⚠️ SIP: Drachtio unavailable:', err?.message || err);
    });
  }

  get isConnected(): boolean {
    return this.connected;
  }

  get ivrSystem(): IVRSystem | null {
    return this.ivr;
  }

  // ─── IVR ─────────────────────────────────────────────

  private async initIvr(): Promise<void> {
    if (!config.ivr.enabled || this.ivr) return;

    console.log('🔄 IVR: Connecting to FreeSWITCH...');
    this.ivr = new IVRSystem(this.srf, this.db);
    if (this.notifyFn) this.ivr.setNotifier(this.notifyFn);
    const ok = await this.ivr.initialize();
    if (ok) console.log('🎙️ IVR: Ready');
    else console.warn('⚠️ IVR: Not available (media features disabled)');
  }

  // ─── SIP Method Handlers ─────────────────────────────

  private registerHandlers(): void {
    this.handleRegister();
    this.handleInvite();
    this.handleOther();
  }

  private handleRegister(): void {
    this.srf.register(async (req: any, res: any) => {
      try {
        if (!this.checkSipRate(req.source_address)) {
          res.send(SipStatus.RateLimited);
          return;
        }

        const fromHeader = req.get('From') || req.get('from') || '';
        const toHeader = req.get('To') || req.get('to') || '';
        const contact = req.get('Contact') || '';
        const expiresHeader = req.get('Expires');

        console.log(`📋 SIP REGISTER raw: From="${fromHeader}" To="${toHeader}" Contact="${contact}" Expires="${expiresHeader}"`);

        const fromMatch = fromHeader.match(/sip:([^@>]+)@/);
        const toMatch = toHeader.match(/sip:([^@>]+)@/);
        const username = fromMatch?.[1] || toMatch?.[1] || req.callingNumber || 'unknown';
        const expires = parseInt(expiresHeader || '3600', 10);

        console.log(`📋 SIP REGISTER: user=${username} expires=${expires}`);

        const user = this.db.getUser(username);
        if (!user) {
          console.log(`❌ SIP REGISTER: Unknown user "${username}" (available: ${this.db.getUsers().map(u => u.extension).join(',')})`);
          res.send(SipStatus.Forbidden);
          return;
        }

        if (expires === 0) {
          await this.registrationStore.unregister(user.extension);
          this.db.unregisterUser(user.extension);
          this.audit.log('unregister', user.extension, { contact }, req.source_address);
          res.send(SipStatus.OK, { headers: { 'Contact': contact, 'Expires': '0' } });
          console.log(`🔴 SIP: ${user.name} unregistered`);
        } else {
          const source = {
            address: req.source_address,
            port: req.source_port,
            protocol: req.protocol,
          };
          await this.registrationStore.register(user.extension, { contact, expires, source });
          this.db.registerUser(user.extension, contact, expires, undefined, source);
          this.audit.log('register', user.extension, { contact, source }, req.source_address);
          res.send(SipStatus.OK, { headers: { 'Contact': contact, 'Expires': expires.toString() } });
    
          // Refresh this user's blocking/forwarding/PSTN detail from Postgres so
          // routing reflects any dashboard changes. Fire-and-forget: the 200 OK
          // is already sent and startup hydration provides a baseline, so a DB
          // hiccup here must not fail the registration.
          void this.db.hydrateUserDetail(user.extension).catch((err: any) =>
            console.warn(`⚠️  detail refresh failed for ${user.extension}: ${err?.message}`),
          );
        }
      } catch (err: any) {
        console.error('❌ SIP REGISTER error:', err.message, err.stack);
        res.send(SipStatus.ServerError);
      }
    });
  }

  private handleInvite(): void {
    console.log('📋 SIP: INVITE handler registered');
    this.srf.invite(async (req: any, res: any) => {
      try {
        if (!this.checkSipRate(req.source_address)) {
          res.send(SipStatus.RateLimited);
          return;
        }

        const calledMatch = req.uri?.match(/sip:([^@]+)/);
        const calledNumber = calledMatch ? calledMatch[1] : req.calledNumber;
        const callingNumber = req.callingNumber || 'unknown';
        const callId = crypto.randomUUID();

        console.log(`📞 SIP INVITE: ${callingNumber} → ${calledNumber}`);

        this.db.logCall({
          id: callId, from: callingNumber, to: calledNumber,
          fromName: this.db.getUser(callingNumber)?.name || callingNumber,
          status: 'ringing', direction: 'inbound', startTime: new Date().toISOString(),
        });
        this.audit.log('call_start', callingNumber, { to: calledNumber, callId }, req.source_address);

        const ctx: CallContext = { req, res, calledNumber, callingNumber, callId };
        const services: RouteServices = {
          srf: this.srf,
          db: this.db,
          trunk: this.trunk,
          audit: this.audit,
          ivr: this.ivr,
          notifyFn: this.notifyFn,
          routeToExtension: this.boundRouteToExtension,
          forwardCall: this.boundForwardCall,
          routeUnreachable: this.boundRouteUnreachable,
        };

        // Try trunk inbound first (before dial plan)
        if (await this.routeHandlers[0].handle(ctx, services)) return;

        // Resolve via dial plan for all other cases
        const route = this.dialPlan.resolve(calledNumber);
        console.log(`🗺️ Dial plan: ${calledNumber} → ${route.type} (${route.normalizedNumber})`);

        // Try each handler in priority order (skip trunk inbound already tried)
        for (let i = 1; i < this.routeHandlers.length; i++) {
          if (await this.routeHandlers[i].handle(ctx, services, route)) return;
        }

        // No route matched
        res.send(SipStatus.TemporarilyUnavailable);
        this.db.updateCall(callId, { status: 'missed' });
      } catch (err: any) {
        console.error('❌ SIP INVITE handler error:', err.message, err.stack);
        if (!res.finalResponseSent) res.send(SipStatus.ServerError);
      }
    });
  }

  private handleOther(): void {
    this.srf.options((_req: any, res: any) => res.send(SipStatus.OK));
    this.srf.info((_req: any, res: any) => res.send(SipStatus.OK));
    this.srf.on('cancel', () => console.log('❌ SIP: Call cancelled'));
    this.srf.message((req: any, res: any) => {
      console.log('📨 SIP MESSAGE:', req.body);
      res.send(SipStatus.OK);
    });
    // Catch unhandled SIP requests for debugging
    (this.srf as any).on('unhandledRequest', (req: any) => {
      console.warn(`⚠️ SIP: Unhandled ${req.method} from ${req.source_address}`);
    });
  }

  // ─── Helpers ─────────────────────────────────────────

  private async routeToExtension(req: any, res: any, contact: string, callId: string): Promise<void> {
    const calledMatch = req.uri?.match(/sip:([^@]+)/);
    const calledExt = calledMatch ? calledMatch[1] : '';
    const callingNumber = req.callingNumber || 'unknown';

    // ─── Block check ───────────────────────────────────
    if (this.db.isBlocked(calledExt, callingNumber)) {
      console.log(`🚫 Blocked: ${callingNumber} → ${calledExt}`);
      this.notifyFn?.(callingNumber, 'declined', { reason: 'blocked', callId });
      this.db.updateCall(callId, { status: 'missed' });
      res.send(SipStatus.Decline, 'Decline');
      return;
    }

    // Get full registration (need source for WS routing)
    const reg = this.db.getRegistration(calledExt);

    // Extract the SIP URI from the contact header
    const contactUriMatch = contact.match(/<([^>]+)>/);
    const contactUri = contactUriMatch ? contactUriMatch[1] : contact;

    console.log(`📞 Routing call via B2BUA:`);
    console.log(`   Called: ${calledExt}`);
    console.log(`   Contact URI: ${contactUri}`);
    if (reg?.source) console.log(`   Source: ${reg.source.protocol}/${reg.source.address}:${reg.source.port}`);

    // Notify caller that the call is ringing (UI plays caller tune)
    this.notifyFn?.(callingNumber, 'ringing', { target: calledExt, callId });

    const b2bOpts: any = {
      proxyRequestHeaders: ['to', 'from', 'cseq', 'max-forwards', 'content-type'],
      proxyResponseHeaders: ['contact', 'allow', 'supported'],
      noAck: false,
      timeout: 15000,
      // Do NOT relay the callee's failure response straight to the caller. We
      // want to keep the caller's INVITE open so that on busy/no-answer/offline
      // /stale-registration (e.g. a 410 Gone) we can run the fallback chain
      // (forward → PSTN → voicemail → "unavailable" announcement) instead of
      // the caller just hearing an error.
      passFailure: false,
    };

    // drachtio-server internally maps .invalid Contact URIs to the WebSocket
    // connection established during REGISTER. Pass Contact URI directly.
    console.log(`   Sending INVITE to: ${contactUri}`);

    try {
      // Create B2BUA with a 15s no-answer timeout
      const { uas, uac } = await this.srf.createB2BUA(req, res, contactUri, b2bOpts);

      console.log(`✅ Call connected: ${callingNumber} → ${calledExt} via B2BUA`);
      this.notifyFn?.(callingNumber, 'answered', { target: calledExt, callId });
      this.audit.log('call_answered', callingNumber, { to: calledExt, callId });

      const onDestroy = () => {
        this.db.updateCall(callId, { status: 'ended', endTime: new Date().toISOString() });
        this.audit.log('call_ended', callingNumber, { to: calledExt, callId });
      };
      uas.on('destroy', () => { uac.destroy(); onDestroy(); });
      uac.on('destroy', () => { uas.destroy(); onDestroy(); });

      this.db.updateCall(callId, { status: 'answered' });
    } catch (err: any) {
      const status = err.status || 0;
      const forwarding = this.db.getForwarding(calledExt);

      if (status === SipStatus.BusyHere || status === SipStatus.Decline) {
        // Declined / Busy
        console.log(`📵 Call declined/busy: ${status}`);
        this.audit.log('call_declined', callingNumber, { to: calledExt, callId, status });
        if (forwarding.busy) {
          console.log(`↪️ Forwarding on busy to ${forwarding.busy}`);
          await this.forwardCall(req, res, forwarding.busy, callId, callingNumber);
        } else {
          this.notifyFn?.(callingNumber, 'declined', { reason: 'busy', callId });
          this.db.updateCall(callId, { status: 'missed' });
          if (!res.finalResponseSent) res.send(SipStatus.BusyHere, 'Busy Here');
        }
      } else if (status === SipStatus.RequestTimeout || err.message?.includes('timeout')) {
        // No answer (timeout)
        console.log(`📵 No answer (timeout): ${calledExt}`);
        if (forwarding.noAnswer) {
          console.log(`↪️ Forwarding on no-answer to ${forwarding.noAnswer}`);
          await this.forwardCall(req, res, forwarding.noAnswer, callId, callingNumber);
        } else {
          this.notifyFn?.(callingNumber, 'no_answer', { callId });
          this.db.updateCall(callId, { status: 'missed' });
          if (!res.finalResponseSent) res.send(SipStatus.TemporarilyUnavailable, 'No Answer');
        }
      } else if (status === SipStatus.RequestTerminated) {
        // Caller cancelled
        console.log(`📵 Call cancelled by caller`);
        this.db.updateCall(callId, { status: 'missed' });
      } else if (
        status === SipStatus.TemporarilyUnavailable ||  // 480
        status === SipStatus.Gone ||                     // 410 — stale registration
        status === SipStatus.NotFound ||                 // 404
        status === SipStatus.ServiceUnavailable ||       // 503
        status === SipStatus.ServerError ||              // 500
        status === 0                                     // transport failure / no response
      ) {
        // Callee can't be reached on their registered device: offline, or a
        // stale registration whose transport is gone (the 410 "Gone" case).
        // Run the shared offline fallback chain (forward → PSTN → voicemail →
        // "unavailable" announcement) and record the call as missed so it shows
        // up in the callee's recents when they next log in.
        console.log(`📵 Callee unreachable (status ${status || 'transport'}): ${calledExt}`);
        if (status >= 500 || status === 0) console.error('❌ B2BUA error:', err.message || err);
        await this.routeUnreachable(req, res, calledExt, callId, callingNumber);
      } else {
        // Genuinely unexpected SIP status (e.g. auth / negotiation failure).
        console.error('❌ Call routing failed:', err.message || err);
        console.error('❌ Full error:', JSON.stringify(err, Object.getOwnPropertyNames(err), 2));
        if (err.status) console.error(`❌ SIP response status: ${err.status}`);
        this.audit.log('call_failed', callingNumber, { to: calledExt, callId, error: err.message });
        this.notifyFn?.(callingNumber, 'failed', { reason: 'error', callId });
        this.db.updateCall(callId, { status: 'missed' });
        if (!res.finalResponseSent) res.send(SipStatus.ServiceUnavailable);
      }
    }
  }

  /**
   * Last-resort handling when the callee can't be reached on their registered
   * device — they never registered (offline) or the registration is stale and
   * the device is gone (a 410 "Gone" / transport failure). Tries, in order:
   *   1. forward-on-unavailable to another extension (if configured),
   *   2. the user's PSTN mobile (if they have one and the trunk is up),
   *   3. voicemail (if enabled and the media server is available),
   *   4. a spoken "the person is unavailable, try later" announcement,
   *   5. a plain SIP 480 when no media server is available.
   * The call is recorded as `unreachable` (or `voicemail` when a message was
   * left, `answered` when PSTN picked up) so it surfaces in the callee's
   * recents. Relies on the caller's INVITE still being open
   * (b2bOpts.passFailure = false), so voicemail/announcement can answer it.
   */
  private async routeUnreachable(
    req: any, res: any, calledExt: string, callId: string, callingNumber: string,
  ): Promise<void> {
    const targetUser = this.db.getUser(calledExt);

    // 1) PSTN fallback: ring the user's mobile if they have one + trunk is up.
    if (targetUser?.mobile && this.trunk.isEnabled) {
      console.log(`📱 ${calledExt} unreachable → PSTN mobile ${targetUser.mobile}`);
      const ok = await this.trunk.routeCall(this.srf, req, res, targetUser.mobile);
      this.db.updateCall(callId, { status: ok ? 'answered' : 'unreachable' });
      if (!ok) this.notifyFn?.(callingNumber, 'unavailable', { target: calledExt, reason: 'pstn_failed', callId });
      return;
    }

    // 2) Forward-on-unavailable to another extension, if configured.
    const forwarding = this.db.getForwarding(calledExt);
    if (forwarding.unavailable) {
      console.log(`↪️ ${calledExt} unreachable → forwarding to ${forwarding.unavailable}`);
      await this.forwardCall(req, res, forwarding.unavailable, callId, callingNumber);
      return;
    }

    // 3) Voicemail: let the caller leave a message for the offline user.
    if (config.voicemail.enabled && this.ivr) {
      console.log(`📭 ${calledExt} unreachable → voicemail`);
      const fromName = req.callingName || callingNumber;
      const saved = await this.ivr.recordVoicemail(req, res, calledExt, callingNumber, fromName);
      // A left message is its own outcome (`voicemail`), not `answered` — the
      // callee never picked up. If nothing was recorded it's `unreachable`.
      this.db.updateCall(callId, { status: saved ? 'voicemail' : 'unreachable' });
      this.notifyFn?.(callingNumber, 'unavailable', { target: calledExt, reason: 'voicemail', callId });
      return;
    }

    // 4) Spoken announcement: tell the caller the user is out of reach, then hang up.
    if (this.ivr) {
      console.log(`📢 ${calledExt} unreachable → "unavailable" announcement`);
      await this.ivr.playUnavailable(req, res);
      this.db.updateCall(callId, { status: 'unreachable' });
      this.notifyFn?.(callingNumber, 'unavailable', { target: calledExt, reason: 'announced', callId });
      return;
    }

    // 5) No media server → plain SIP failure. Still record the missed call.
    console.log(`📴 ${calledExt} unreachable → no media; sending 480`);
    this.notifyFn?.(callingNumber, 'unavailable', { target: calledExt, reason: 'offline', callId });
    this.db.updateCall(callId, { status: 'unreachable' });
    if (!res.finalResponseSent) {
      res.send(SipStatus.TemporarilyUnavailable, 'User Unavailable', {
        headers: { 'Reason': 'SIP;cause=480;text="User is unreachable"' },
      });
    }
  }

  private async forwardCall(req: any, res: any, target: string, callId: string, callingNumber: string): Promise<void> {
    const reg = this.db.getRegistration(target);
    if (!reg) {
      // Forward target not registered → try PSTN mobile fallback
      const targetUser = this.db.getUser(target);
      if (targetUser?.mobile && this.trunk.isEnabled) {
        console.log(`📱 Forward PSTN fallback: ${target} → mobile ${targetUser.mobile}`);
        const ok = await this.trunk.routeCall(this.srf, req, res, targetUser.mobile);
        this.db.updateCall(callId, { status: ok ? 'answered' : 'failed' });
        return;
      }
      console.log(`❌ Forward target ${target} not registered`);
      this.notifyFn?.(callingNumber, 'unavailable', { callId });
      this.db.updateCall(callId, { status: 'missed' });
      if (!res.finalResponseSent) res.send(SipStatus.TemporarilyUnavailable);
      return;
    }

    const contactUriMatch = reg.contact.match(/<([^>]+)>/);
    const contactUri = contactUriMatch ? contactUriMatch[1] : reg.contact;

    console.log(`📞 Forwarding to ${target} (${contactUri})`);
    this.notifyFn?.(callingNumber, 'forwarding', { target, callId });

    const fwdOpts: any = {
      proxyRequestHeaders: ['to', 'from', 'cseq', 'max-forwards', 'content-type'],
      proxyResponseHeaders: ['contact', 'allow', 'supported'],
    };

    try {
      const { uas, uac } = await this.srf.createB2BUA(req, res, contactUri, fwdOpts);

      console.log(`✅ Call forwarded: ${callingNumber} → ${target}`);
      this.notifyFn?.(callingNumber, 'answered', { target, callId });

      const onDestroy = () => {
        this.db.updateCall(callId, { status: 'ended', endTime: new Date().toISOString() });
      };
      uas.on('destroy', () => { uac.destroy(); onDestroy(); });
      uac.on('destroy', () => { uas.destroy(); onDestroy(); });

      this.db.updateCall(callId, { status: 'answered' });
    } catch (fwdErr: any) {
      console.error(`❌ Forward to ${target} failed:`, fwdErr.message);
      this.notifyFn?.(callingNumber, 'failed', { reason: 'forward_failed', callId });
      this.db.updateCall(callId, { status: 'failed' });
      if (!res.finalResponseSent) res.send(SipStatus.ServiceUnavailable);
    }
  }
}
