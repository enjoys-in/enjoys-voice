import Srf from 'drachtio-srf';
import crypto from 'crypto';
import { config, verifyWidgetToken } from '@/core';
import type { WidgetTokenClaims } from '@/core';
import { SipStatus, CallStatus, CallDirection, UnreachableReason, CallNotifyEvent, CallNotifyReason } from '@/core/types';
import { DatabaseService, TrunkService, AuditService, DialPlanService, RouteType } from '@/services';
import type { DialResult, ConferenceService, QueueService, RoutingRuleRecord } from '@/services';
import type { RegistrationStore } from '@/services/registration';
import type { RoutingOrchestrator } from '@/modules/routing';
import { IVRSystem } from './ivr.system';
import { SipAbuseGuard } from './abuse-guard';
import {
  TrunkInboundHandler, TeamsMeetingHandler, ConferenceHandler, QueueHandler, EmergencyHandler, IvrHandler,
  InternalHandler, ExternalHandler, WidgetHandler,
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
  private readonly SIP_RATE_LIMIT = config.sip.rateLimit; // per window per IP (env SIP_RATE_LIMIT)
  private readonly SIP_RATE_WINDOW = config.sip.rateWindowMs;
  /** Abuse guard: bans source IPs that repeatedly flood/scan/spoof. */
  private readonly abuse: SipAbuseGuard;

  // ─── Route Handlers (ordered by priority) ────────────
  // The IVR and Internal handlers are also referenced by name so a matching
  // per-user routing rule can dispatch a call straight into them.
  private ivrHandler = new IvrHandler();
  private internalHandler = new InternalHandler();
  private routeHandlers: RouteHandler[] = [
    new TrunkInboundHandler(),
    new WidgetHandler(),
    new TeamsMeetingHandler(),
    new ConferenceHandler(),
    new QueueHandler(),
    new EmergencyHandler(),
    this.ivrHandler,
    this.internalHandler,
    new ExternalHandler(),
  ];

  constructor(
    private db: DatabaseService,
    private trunk: TrunkService,
    private registrationStore: RegistrationStore,
    private audit: AuditService,
    private conference: ConferenceService,
    private queue: QueueService,
    private routing?: RoutingOrchestrator,
  ) {
    this.srf = new Srf();
    // Pre-bind to avoid allocating new functions on every INVITE
    this.boundRouteToExtension = this.routeToExtension.bind(this);
    this.boundForwardCall = this.forwardCall.bind(this);
    this.boundRouteUnreachable = this.routeUnreachable.bind(this);
    this.boundRouteDoNotDisturb = this.routeDoNotDisturb.bind(this);

    // Abuse guard. Trunk edges and explicitly-trusted IPs are never banned, so
    // a busy provider or office NAT can't lock itself out.
    this.abuse = new SipAbuseGuard({
      threshold: config.sip.banThreshold,
      windowMs: config.sip.banWindowMs,
      banMs: config.sip.banDurationMs,
      firewallCmd: config.sip.firewallCmd,
      isTrusted: (ip) => this.trunk.isFromTrunk(ip) || config.sip.trustedIps.includes(ip),
    });
  }

  private readonly boundRouteToExtension: RouteServices['routeToExtension'];
  private readonly boundForwardCall: RouteServices['forwardCall'];
  private readonly boundRouteUnreachable: RouteServices['routeUnreachable'];
  private readonly boundRouteDoNotDisturb: RouteServices['routeDoNotDisturb'];

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

    this.srf.connect({
      ...config.drachtio,
      // Raw SIP wire traces are very noisy; only emit them when explicitly
      // debugging drachtio (DRACHTIO_DEBUG=true).
      ...(process.env.DRACHTIO_DEBUG === 'true'
        ? { logger: (message: string) => console.log(`📡 [Drachtio]: ${message}`) }
        : {}),
    });

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
    this.ivr = new IVRSystem(this.srf, this.db, undefined, this.routing);
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
    this.srf.register(async (req: Srf.SrfRequest, res: Srf.SrfResponse) => {
      try {
        const ip = req.source_address;
        // Banned source → refuse instantly, before any rate accounting or lookup.
        if (this.abuse.isBanned(ip)) {
          res.send(SipStatus.Forbidden);
          return;
        }
        if (!this.checkSipRate(ip)) {
          this.abuse.recordOffense(ip, 'register_flood');
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
          // Credential scanning — count it toward an IP ban.
          this.abuse.recordOffense(ip, 'unknown_register');
          res.send(SipStatus.Forbidden);
          return;
        }

        if (expires === 0) {
          await this.registrationStore.unregister(user.extension);
          this.db.unregisterUser(user.extension);
          this.audit.log('unregister', user.extension, { contact }, req.source_address);
          res.send(SipStatus.OK, { headers: { 'Contact': contact, 'Expires': '0' } });
          console.log(`🔴 SIP: ${user.name} unregistered`);
          // Reflect the agent going offline in any queues they belong to.
          this.queue.syncPresence();
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
          // A valid registration clears this IP's offense tally so a real user
          // behind a shared NAT isn't punished for a scanner on the same address.
          this.abuse.recordSuccess(ip);

          // Refresh this user's blocking/forwarding/PSTN detail from Postgres so
          // routing reflects any dashboard changes. Fire-and-forget: the 200 OK
          // is already sent and startup hydration provides a baseline, so a DB
          // hiccup here must not fail the registration.
          void this.db.hydrateUserDetail(user.extension).catch((err: any) =>
            console.warn(`⚠️  detail refresh failed for ${user.extension}: ${err?.message}`),
          );
          // Reflect the agent coming online in any queues they belong to.
          this.queue.syncPresence();
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
      const ip = req.source_address;
      try {
        // Banned source → refuse instantly, before any rate accounting, routing,
        // DB lookup, or call-history write.
        if (this.abuse.isBanned(ip)) {
          res.send(SipStatus.Forbidden);
          return;
        }
        if (!this.checkSipRate(ip)) {
          this.abuse.recordOffense(ip, 'invite_flood');
          res.send(SipStatus.RateLimited);
          return;
        }

        const calledMatch = req.uri?.match(/sip:([^@]+)/);
        const calledNumber = calledMatch ? calledMatch[1] : req.calledNumber;

        // ─── Widget capability token ─────────────────────────────────────
        // The embeddable click-to-call widget can't be a registered SIP user,
        // so it instead carries a short-lived capability token (minted by
        // POST /api/n/widget/session) in the X-Widget-Token header. A valid
        // token authorizes this call: it bypasses the registered-caller
        // legitimacy screen below, and the WidgetHandler later pins the call to
        // exactly the destination + caller-ID the token was issued for.
        const widgetClaims = this.parseWidgetToken(req);

        // The widget dials as a guest SIP user ("widget"); its AUTHORITATIVE
        // caller identity is the key's caller-ID (always the key owner's own
        // extension) carried in the signed token. Attribute the call to it so
        // the callee, call history and voicemail all show the owner's extension
        // rather than the guest placeholder From — and a tampered widget can't
        // present some other number on an internal call.
        const callingNumber = widgetClaims?.callerId || req.callingNumber || 'unknown';

        // ─── Anti-spoof / anti-scan screen ───────────────────────────────
        // Decide if this INVITE is even worth processing BEFORE we create a
        // call-history row. Inbound trunk calls, calls to a known extension, and
        // a registered user dialing out are legitimate; everything else (a
        // 16-digit garbage destination, a spoofed From for an unregistered
        // extension trying to use our trunk, etc.) is a probe → fast 403, an
        // offense toward an IP ban, and NO "missed call" left behind.
        const fromTrunk = this.trunk.isFromTrunk(ip);
        const route = this.dialPlan.resolve(calledNumber);
        if (!fromTrunk && !widgetClaims && !this.isInviteLegitimate(route, callingNumber)) {
          this.abuse.recordOffense(ip, `unroutable:${route.type}`);
          console.warn(`🚫 Rejected INVITE ${callingNumber} → ${calledNumber} (${route.type}, src ${ip}) — not routable/spoofed`);
          this.audit.log('call_blocked', callingNumber, {
            to: calledNumber, reason: 'unroutable_or_spoofed', route: route.type,
          }, ip);
          res.send(SipStatus.Forbidden);
          return;
        }

        const callId = crypto.randomUUID();
        console.log(`📞 SIP INVITE: ${callingNumber} → ${calledNumber}`);

        this.db.logCall({
          id: callId, from: callingNumber, to: calledNumber,
          fromName: this.db.getUser(callingNumber)?.name || callingNumber,
          status: CallStatus.Ringing, direction: CallDirection.Inbound, startTime: new Date().toISOString(),
        });
        this.audit.log('call_start', callingNumber, { to: calledNumber, callId }, ip);

        const ctx: CallContext = { req, res, calledNumber, callingNumber, callId, widget: widgetClaims };
        const services: RouteServices = {
          srf: this.srf,
          db: this.db,
          trunk: this.trunk,
          audit: this.audit,
          ivr: this.ivr,
          conference: this.conference,
          queue: this.queue,
          notifyFn: this.notifyFn,
          routing: this.routing,
          routeToExtension: this.boundRouteToExtension,
          forwardCall: this.boundForwardCall,
          routeUnreachable: this.boundRouteUnreachable,
          routeDoNotDisturb: this.boundRouteDoNotDisturb,
        };

        // ─── Per-user routing rules (self-service) ──────────────────────
        // A user can route the inbound calls reaching them (their own extension
        // or a DID) to one of their own IVR flows, another extension, a PSTN
        // number, or voicemail. A matching enabled rule overrides the default
        // dial-plan / DID behavior, so it is consulted before the trunk-inbound
        // and dial-plan handlers. Widget calls are exempt: their destination is
        // already pinned by the capability token. Lookups are cached in memory
        // (negative cache too) so most calls — which have no override — don't
        // hit Postgres.
        if (!widgetClaims) {
          const routingRule = await this.db.getRoutingRule(calledNumber);
          if (routingRule) {
            console.log(`🧭 Routing rule: ${calledNumber} → ${routingRule.destinationType}${routingRule.destinationValue ? `:${routingRule.destinationValue}` : ''} (owner ${routingRule.ownerExtension})`);
            this.audit.log('call_routed', callingNumber, {
              to: calledNumber, callId,
              destinationType: routingRule.destinationType,
              destinationValue: routingRule.destinationValue || routingRule.ownerExtension,
            }, ip);
            if (await this.dispatchRoutingRule(ctx, services, routingRule)) return;
          }
        }

        // Try trunk inbound first (before dial plan)
        if (await this.routeHandlers[0].handle(ctx, services)) return;

        console.log(`🗺️ Dial plan: ${calledNumber} → ${route.type} (${route.normalizedNumber})`);
        // Try each handler in priority order (skip trunk inbound already tried)
        for (let i = 1; i < this.routeHandlers.length; i++) {
          if (await this.routeHandlers[i].handle(ctx, services, route)) return;
        }

        // No route matched
        res.send(SipStatus.TemporarilyUnavailable);
        this.db.updateCall(callId, { status: CallStatus.Missed });
      } catch (err: any) {
        console.error('❌ SIP INVITE handler error:', err.message, err.stack);
        if (!res.finalResponseSent) res.send(SipStatus.ServerError);
      }
    });
  }

  /**
   * Apply a matched per-user routing rule to an inbound call, overriding the
   * default dial-plan / DID behavior. Returns true when the call was handled
   * (the INVITE pipeline should stop), false when the rule couldn't be applied
   * and normal routing should continue.
   */
  private async dispatchRoutingRule(
    ctx: CallContext, services: RouteServices, rule: RoutingRuleRecord,
  ): Promise<boolean> {
    switch (rule.destinationType) {
      case RouteType.IVR: {
        // Route into the matching IVR flow by its entry extension.
        const route: DialResult = {
          type: RouteType.IVR,
          target: rule.destinationValue,
          originalNumber: ctx.calledNumber,
          normalizedNumber: rule.destinationValue,
        };
        return this.ivrHandler.handle(ctx, services, route);
      }
      case 'extension': {
        // Ring another internal extension, reusing the internal handler so the
        // schedule gate, DND and offline-fallback chain all still apply.
        const route: DialResult = {
          type: RouteType.Internal,
          target: rule.destinationValue,
          originalNumber: ctx.calledNumber,
          normalizedNumber: rule.destinationValue,
        };
        return this.internalHandler.handle(ctx, services, route);
      }
      case 'pstn': {
        // Forward out to a PSTN number. We bypass the external handler (whose
        // toll-fraud gate requires a registered caller) because this forward is
        // the rule owner's own explicit, authorized configuration.
        if (!this.trunk.isEnabled) {
          if (!ctx.res.finalResponseSent) ctx.res.send(SipStatus.TemporarilyUnavailable);
          this.db.updateCall(ctx.callId, { status: CallStatus.Missed });
          return true;
        }
        const target = this.dialPlan.resolve(rule.destinationValue).normalizedNumber;
        console.log(`🧭 Routing → PSTN ${target} (rule owner ${rule.ownerExtension})`);
        const ok = await this.trunk.routeCall(this.srf, ctx.req, ctx.res, target);
        this.db.updateCall(ctx.callId, { status: ok ? CallStatus.Answered : CallStatus.Failed });
        return true;
      }
      case 'voicemail': {
        // Send the caller straight to the rule owner's voicemail.
        if (config.voicemail.enabled && this.ivr) {
          const fromName = ctx.req.callingName || this.db.getUser(ctx.callingNumber)?.name || ctx.callingNumber;
          const saved = await this.ivr.recordVoicemail(ctx.req, ctx.res, rule.ownerExtension, ctx.callingNumber, fromName);
          this.db.updateCall(ctx.callId, { status: saved ? CallStatus.Voicemail : CallStatus.Missed });
        } else {
          if (!ctx.res.finalResponseSent) ctx.res.send(SipStatus.TemporarilyUnavailable);
          this.db.updateCall(ctx.callId, { status: CallStatus.Missed });
        }
        return true;
      }
      default:
        return false;
    }
  }

  /**
   * Read and verify the X-Widget-Token capability token from an INVITE, if
   * present. Returns the claims on success, or undefined when the header is
   * absent or the token is invalid/expired — in which case the call falls
   * through to the normal legitimacy screen and is refused like any other
   * unregistered caller.
   */
  private parseWidgetToken(req: any): WidgetTokenClaims | undefined {
    const raw =
      (typeof req.get === 'function' ? req.get('X-Widget-Token') : '') ||
      req.headers?.['x-widget-token'] ||
      '';
    const token = String(raw).trim();
    if (!token) return undefined;
    return verifyWidgetToken(token) ?? undefined;
  }

  /**
   * Pre-routing legitimacy screen for a non-trunk INVITE. Returns false for
   * probes/spoofs so they can be refused before any call record is written:
   *  - Internal  → must target a KNOWN extension (registered or known-offline).
   *  - External  → caller must be one of OUR registered extensions (same rule
   *                the toll-fraud gate enforces); a spoofed From for an unknown
   *                extension trying to reach the PSTN trunk is refused here.
   *  - IVR/Emergency → always allowed.
   */
  private isInviteLegitimate(route: DialResult, caller: string): boolean {
    switch (route.type) {
      case RouteType.Internal:
        return !!this.db.getUser(route.target);
      case RouteType.External:
        return this.db.isRegistered(caller);
      case RouteType.Conference:
        return this.db.isRegistered(caller);
      case RouteType.Queue:
        return this.db.isRegistered(caller);
      case RouteType.IVR:
      case RouteType.Emergency:
        return true;
      default:
        return false;
    }
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
      this.notifyFn?.(callingNumber, CallNotifyEvent.Declined, { reason: CallNotifyReason.Blocked, callId });
      this.db.updateCall(callId, { status: CallStatus.Missed });
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
    this.notifyFn?.(callingNumber, CallNotifyEvent.Ringing, { target: calledExt, callId });

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
      this.notifyFn?.(callingNumber, CallNotifyEvent.Answered, { target: calledExt, callId });
      this.audit.log('call_answered', callingNumber, { to: calledExt, callId });

      const onDestroy = () => {
        this.db.updateCall(callId, { status: CallStatus.Ended, endTime: new Date().toISOString() });
        this.audit.log('call_ended', callingNumber, { to: calledExt, callId });
      };
      uas.on('destroy', () => { uac.destroy(); onDestroy(); });
      uac.on('destroy', () => { uas.destroy(); onDestroy(); });

      this.db.updateCall(callId, { status: CallStatus.Answered });
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
          // No busy-forward rule: play a "currently busy" status tone. Voicemail
          // is intentionally NOT offered here — the device WAS reachable, the
          // callee just declined (voicemail is gated to the offline path only).
          this.notifyFn?.(callingNumber, CallNotifyEvent.Declined, { reason: CallNotifyReason.Busy, callId });
          await this.routeUnreachable(req, res, calledExt, callId, callingNumber, UnreachableReason.Busy);
        }
      } else if (status === SipStatus.RequestTimeout || err.message?.includes('timeout')) {
        // No answer (timeout)
        console.log(`📵 No answer (timeout): ${calledExt}`);
        if (forwarding.noAnswer) {
          console.log(`↪️ Forwarding on no-answer to ${forwarding.noAnswer}`);
          await this.forwardCall(req, res, forwarding.noAnswer, callId, callingNumber);
        } else {
          // No no-answer forward rule: play a "not answering" status tone and
          // record the call as missed. Voicemail is gated to the offline path
          // only, so an unanswered (but reachable) device does NOT go to VM.
          this.notifyFn?.(callingNumber, CallNotifyEvent.NoAnswer, { callId });
          await this.routeUnreachable(req, res, calledExt, callId, callingNumber, UnreachableReason.NoAnswer);
        }
      } else if (status === SipStatus.RequestTerminated) {
        // Caller cancelled
        console.log(`📵 Call cancelled by caller`);
        this.db.updateCall(callId, { status: CallStatus.Missed });
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
        this.notifyFn?.(callingNumber, CallNotifyEvent.Failed, { reason: CallNotifyReason.Error, callId });
        this.db.updateCall(callId, { status: CallStatus.Missed });
        if (!res.finalResponseSent) res.send(SipStatus.ServiceUnavailable);
      }
    }
  }

  /**
   * Last-resort handling when the callee can't be reached on their registered
   * device — they never registered (offline) or the registration is stale and
   * the device is gone (a 410 "Gone" / transport failure). Tries, in order:
   *   1. the user's PSTN mobile (if they have one and the trunk is up),
   *   2. forward-on-unavailable to another extension (if configured),
   *   3. voicemail — ONLY when `reason === UnreachableReason.Offline` (gated so
   *      a busy/decline or no-answer never drops the caller into voicemail),
   *   4. a reason-specific spoken status tone (busy / no-answer / unavailable),
   *   5. a plain SIP 480 when no media server is available.
   * `reason` distinguishes a genuinely OFFLINE callee (full chain incl. VM) from
   * a reachable device that was busy/declined or rang out (tone only, recorded
   * `missed`). The call is recorded `unreachable` when offline, `missed` for
   * busy/no-answer, `voicemail` when a message was left, or `answered` when PSTN
   * picked up — so it surfaces in the callee's recents. Relies on the caller's
   * INVITE still being open (b2bOpts.passFailure = false) so VM/tone can answer it.
   */
  private async routeUnreachable(
    req: any, res: any, calledExt: string, callId: string, callingNumber: string,
    reason: UnreachableReason = UnreachableReason.Offline,
  ): Promise<void> {
    const targetUser = this.db.getUser(calledExt);

    // 1) PSTN fallback: ring the user's mobile if they have one + trunk is up.
    if (targetUser?.mobile && this.trunk.isEnabled) {
      console.log(`📱 ${calledExt} unreachable → PSTN mobile ${targetUser.mobile}`);
      const ok = await this.trunk.routeCall(this.srf, req, res, targetUser.mobile);
      this.db.updateCall(callId, { status: ok ? CallStatus.Answered : CallStatus.Unreachable });
      if (!ok) this.notifyFn?.(callingNumber, CallNotifyEvent.Unavailable, { target: calledExt, reason: CallNotifyReason.PstnFailed, callId });
      return;
    }

    // 2) Forward-on-unavailable to another extension, if configured.
    const forwarding = this.db.getForwarding(calledExt);
    if (forwarding.unavailable) {
      console.log(`↪️ ${calledExt} unreachable → forwarding to ${forwarding.unavailable}`);
      await this.forwardCall(req, res, forwarding.unavailable, callId, callingNumber);
      return;
    }

    // 3) Voicemail — ONLY when the callee is genuinely OFFLINE. On a busy/decline
    //    or no-answer the device WAS reachable (the callee just declined or let it
    //    ring out), so we skip voicemail and play a spoken status tone instead.
    if (reason === UnreachableReason.Offline && config.voicemail.enabled && this.ivr) {
      console.log(`📭 ${calledExt} offline → voicemail`);
      const fromName = req.callingName || this.db.getUser(callingNumber)?.name || callingNumber;
      const saved = await this.ivr.recordVoicemail(req, res, calledExt, callingNumber, fromName);
      // A left message is its own outcome (`voicemail`), not `answered` — the
      // callee never picked up. If nothing was recorded it's `unreachable`.
      this.db.updateCall(callId, { status: saved ? CallStatus.Voicemail : CallStatus.Unreachable });
      this.notifyFn?.(callingNumber, CallNotifyEvent.Unavailable, { target: calledExt, reason: CallNotifyReason.Voicemail, callId });
      return;
    }

    // 4) Spoken announcement: a reason-specific status tone, then hang up.
    //    busy → "currently busy"; no-answer → "not answering"; offline →
    //    the default "not available right now" message.
    if (this.ivr) {
      const message =
        reason === UnreachableReason.Busy
          ? 'The person you are trying to reach is currently busy. Please try again later.'
          : reason === UnreachableReason.NoAnswer
            ? 'The person you are trying to reach is not answering. Please try again later.'
            : undefined;
      console.log(`📢 ${calledExt} ${reason} → status announcement`);
      await this.ivr.playUnavailable(req, res, message);
      this.db.updateCall(callId, { status: reason === UnreachableReason.Offline ? CallStatus.Unreachable : CallStatus.Missed });
      this.notifyFn?.(callingNumber, CallNotifyEvent.Unavailable, { target: calledExt, reason, callId });
      return;
    }

    // 5) No media server → plain SIP failure. Still record the call.
    console.log(`📴 ${calledExt} ${reason} → no media; sending 480`);
    this.notifyFn?.(callingNumber, CallNotifyEvent.Unavailable, { target: calledExt, reason, callId });
    this.db.updateCall(callId, { status: reason === UnreachableReason.Offline ? CallStatus.Unreachable : CallStatus.Missed });
    if (!res.finalResponseSent) {
      res.send(SipStatus.TemporarilyUnavailable, 'User Unavailable', {
        headers: { 'Reason': 'SIP;cause=480;text="User is unreachable"' },
      });
    }
  }

  /**
   * Do Not Disturb: the target IS registered but has DND switched on, so we do
   * NOT ring their device. Send the caller straight to voicemail (so they can
   * still leave a message); when voicemail is off, return a silent SIP 480.
   * This is intentional silence — distinct from `routeUnreachable`, which runs
   * the PSTN/forward/announce fallback chain for a genuinely offline user.
   */
  private async routeDoNotDisturb(
    req: any, res: any, calledExt: string, callId: string, callingNumber: string,
  ): Promise<void> {
    // Voicemail: let the caller leave a message even though the device is silent.
    if (config.voicemail.enabled && this.ivr) {
      console.log(`🔕 ${calledExt} on DND → voicemail`);
      const fromName = req.callingName || this.db.getUser(callingNumber)?.name || callingNumber;
      const saved = await this.ivr.recordVoicemail(req, res, calledExt, callingNumber, fromName);
      this.db.updateCall(callId, { status: saved ? CallStatus.Voicemail : CallStatus.Missed });
      this.notifyFn?.(callingNumber, CallNotifyEvent.Unavailable, { target: calledExt, reason: CallNotifyReason.Dnd, callId });
      return;
    }

    // No voicemail → silent rejection. Record as missed for the callee's recents.
    console.log(`🔕 ${calledExt} on DND → no voicemail; sending 480`);
    this.notifyFn?.(callingNumber, CallNotifyEvent.Unavailable, { target: calledExt, reason: CallNotifyReason.Dnd, callId });
    this.db.updateCall(callId, { status: CallStatus.Missed });
    if (!res.finalResponseSent) {
      res.send(SipStatus.TemporarilyUnavailable, 'Do Not Disturb', {
        headers: { 'Reason': 'SIP;cause=480;text="Do Not Disturb"' },
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
        this.db.updateCall(callId, { status: ok ? CallStatus.Answered : CallStatus.Failed });
        return;
      }
      console.log(`❌ Forward target ${target} not registered`);
      this.notifyFn?.(callingNumber, CallNotifyEvent.Unavailable, { callId });
      this.db.updateCall(callId, { status: CallStatus.Missed });
      if (!res.finalResponseSent) res.send(SipStatus.TemporarilyUnavailable);
      return;
    }

    const contactUriMatch = reg.contact.match(/<([^>]+)>/);
    const contactUri = contactUriMatch ? contactUriMatch[1] : reg.contact;

    console.log(`📞 Forwarding to ${target} (${contactUri})`);
    this.notifyFn?.(callingNumber, CallNotifyEvent.Forwarding, { target, callId });

    const fwdOpts: any = {
      proxyRequestHeaders: ['to', 'from', 'cseq', 'max-forwards', 'content-type'],
      proxyResponseHeaders: ['contact', 'allow', 'supported'],
    };

    try {
      const { uas, uac } = await this.srf.createB2BUA(req, res, contactUri, fwdOpts);

      console.log(`✅ Call forwarded: ${callingNumber} → ${target}`);
      this.notifyFn?.(callingNumber, CallNotifyEvent.Answered, { target, callId });
      // Audit the transfer (also drives the `call.transferred` webhook event).
      this.audit.log('call_forwarded', callingNumber, { to: target, callId });

      const onDestroy = () => {
        this.db.updateCall(callId, { status: CallStatus.Ended, endTime: new Date().toISOString() });
      };
      uas.on('destroy', () => { uac.destroy(); onDestroy(); });
      uac.on('destroy', () => { uas.destroy(); onDestroy(); });

      this.db.updateCall(callId, { status: CallStatus.Answered });
    } catch (fwdErr: any) {
      console.error(`❌ Forward to ${target} failed:`, fwdErr.message);
      this.notifyFn?.(callingNumber, CallNotifyEvent.Failed, { reason: CallNotifyReason.ForwardFailed, callId });
      this.db.updateCall(callId, { status: CallStatus.Failed });
      if (!res.finalResponseSent) res.send(SipStatus.ServiceUnavailable);
    }
  }
}
