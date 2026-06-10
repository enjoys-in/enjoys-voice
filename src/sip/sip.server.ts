import Srf from 'drachtio-srf';
import crypto from 'crypto';
import { config } from '@/core';
import { DatabaseService, TrunkService, AuditService, DialPlanService } from '@/services';
import type { RegistrationStore } from '@/services/registration';
import { IVRSystem } from './ivr.system';

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

  constructor(
    private db: DatabaseService,
    private trunk: TrunkService,
    private registrationStore: RegistrationStore,
    private audit: AuditService,
  ) {
    this.srf = new Srf();
  }

  /** Register a callback to notify users of call events via WebSocket */
  setNotifier(fn: (extension: string, event: string, data?: any) => void): void {
    this.notifyFn = fn;
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
          res.send(429);
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
          res.send(403);
          return;
        }

        if (expires === 0) {
          await this.registrationStore.unregister(user.extension);
          this.db.unregisterUser(user.extension);
          this.audit.log('unregister', user.extension, { contact }, req.source_address);
          res.send(200, { headers: { 'Contact': contact, 'Expires': '0' } });
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
          res.send(200, { headers: { 'Contact': contact, 'Expires': expires.toString() } });
          console.log(`✅ SIP: ${user.name} registered at ${contact} (source: ${source.protocol}/${source.address}:${source.port})`);
        }
      } catch (err: any) {
        console.error('❌ SIP REGISTER error:', err.message, err.stack);
        res.send(500);
      }
    });
  }

  private handleInvite(): void {
    this.srf.invite(async (req: any, res: any) => {
      if (!this.checkSipRate(req.source_address)) {
        res.send(429);
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

      // Use dial plan to resolve routing
      const route = this.dialPlan.resolve(calledNumber);
      console.log(`🗺️ Dial plan: ${calledNumber} → ${route.type} (${route.normalizedNumber})`);

      // Emergency calls always go to trunk
      if (route.type === 'emergency') {
        console.log(`🚨 Emergency: Routing ${route.target} to trunk`);
        if (this.trunk.isEnabled) {
          const ok = await this.trunk.routeCall(this.srf, req, res, route.target);
          this.db.updateCall(callId, { status: ok ? 'answered' : 'failed' });
        } else {
          res.send(503);
          this.db.updateCall(callId, { status: 'failed' });
        }
        return;
      }

      // IVR routing
      if (route.type === 'ivr' && this.ivr?.isConnected() && config.ivr.enabled) {
        console.log(`🎙️ IVR: Routing call`);
        try {
          await this.ivr.handleIncomingCall(req, res);
        } catch (ivrErr: any) {
          console.error('❌ IVR routing failed:', ivrErr.message);
          if (!res.finalResponseSent) res.send(503);
          this.db.updateCall(callId, { status: 'failed' });
        }
        return;
      }

      // Internal extension
      if (route.type === 'internal') {
        const reg = this.db.getRegistration(route.target);
        if (reg) {
          await this.routeToExtension(req, res, reg.contact, callId);
          return;
        }
        // Internal ext not registered → try PSTN fallback via mobile number
        const targetUser = this.db.getUser(route.target);
        if (targetUser?.mobile && this.trunk.isEnabled) {
          console.log(`📱 PSTN fallback: ${route.target} → mobile ${targetUser.mobile}`);
          const ok = await this.trunk.routeCall(this.srf, req, res, targetUser.mobile);
          this.db.updateCall(callId, { status: ok ? 'answered' : 'failed' });
          return;
        }
      }

      // External via trunk
      if (route.type === 'external' && this.trunk.isEnabled) {
        console.log(`📞 Trunk: Routing to ${route.normalizedNumber}`);
        const ok = await this.trunk.routeCall(this.srf, req, res, route.normalizedNumber);
        this.db.updateCall(callId, { status: ok ? 'answered' : 'failed' });
        return;
      }

      // No route
      res.send(480);
      this.db.updateCall(callId, { status: 'missed' });
    });
  }

  private handleOther(): void {
    this.srf.options((_req: any, res: any) => res.send(200));
    this.srf.info((_req: any, res: any) => res.send(200));
    this.srf.on('cancel', () => console.log('❌ SIP: Call cancelled'));
    this.srf.message((req: any, res: any) => {
      console.log('📨 SIP MESSAGE:', req.body);
      res.send(200);
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
      res.send(603, 'Decline');
      return;
    }

    // Extract the SIP URI from the contact header
    const contactUriMatch = contact.match(/<([^>]+)>/);
    const contactUri = contactUriMatch ? contactUriMatch[1] : contact;

    console.log(`📞 Routing call via B2BUA:`);
    console.log(`   Called: ${calledExt}`);
    console.log(`   Contact URI: ${contactUri}`);

    // Notify caller that the call is ringing (UI plays caller tune)
    this.notifyFn?.(callingNumber, 'ringing', { target: calledExt, callId });

    try {
      // Create B2BUA with a 15s no-answer timeout
      const { uas, uac } = await this.srf.createB2BUA(req, res, contactUri, {
        proxyRequestHeaders: ['to', 'from', 'call-id', 'cseq', 'max-forwards', 'content-type'],
        proxyResponseHeaders: ['contact', 'allow', 'supported'],
        noAck: false,
        timeout: 15000, // 15 second ring timeout
      });

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

      if (status === 486 || status === 603) {
        // Declined / Busy
        console.log(`📵 Call declined/busy: ${status}`);
        this.audit.log('call_declined', callingNumber, { to: calledExt, callId, status });
        if (forwarding.busy) {
          console.log(`↪️ Forwarding on busy to ${forwarding.busy}`);
          await this.forwardCall(req, res, forwarding.busy, callId, callingNumber);
        } else {
          this.notifyFn?.(callingNumber, 'declined', { reason: 'busy', callId });
          this.db.updateCall(callId, { status: 'missed' });
          if (!res.finalResponseSent) res.send(486, 'Busy Here');
        }
      } else if (status === 408 || err.message?.includes('timeout')) {
        // No answer (timeout)
        console.log(`📵 No answer (timeout): ${calledExt}`);
        if (forwarding.noAnswer) {
          console.log(`↪️ Forwarding on no-answer to ${forwarding.noAnswer}`);
          await this.forwardCall(req, res, forwarding.noAnswer, callId, callingNumber);
        } else {
          this.notifyFn?.(callingNumber, 'no_answer', { callId });
          this.db.updateCall(callId, { status: 'missed' });
          if (!res.finalResponseSent) res.send(480, 'No Answer');
        }
      } else if (status === 487) {
        // Caller cancelled
        console.log(`📵 Call cancelled by caller`);
        this.db.updateCall(callId, { status: 'missed' });
      } else if (status === 480) {
        // Unavailable
        console.log(`📵 Callee unavailable`);
        if (forwarding.unavailable) {
          console.log(`↪️ Forwarding on unavailable to ${forwarding.unavailable}`);
          await this.forwardCall(req, res, forwarding.unavailable, callId, callingNumber);
        } else {
          this.notifyFn?.(callingNumber, 'unavailable', { callId });
          this.db.updateCall(callId, { status: 'missed' });
          if (!res.finalResponseSent) res.send(480);
        }
      } else {
        console.error('❌ Call routing failed:', err.message);
        if (err.status) console.error(`❌ SIP response status: ${err.status}`);
        this.audit.log('call_failed', callingNumber, { to: calledExt, callId, error: err.message });
        this.notifyFn?.(callingNumber, 'failed', { reason: 'error', callId });
        this.db.updateCall(callId, { status: 'failed' });
        if (!res.finalResponseSent) res.send(503);
      }
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
      if (!res.finalResponseSent) res.send(480);
      return;
    }

    const contactUriMatch = reg.contact.match(/<([^>]+)>/);
    const contactUri = contactUriMatch ? contactUriMatch[1] : reg.contact;

    console.log(`📞 Forwarding to ${target} (${contactUri})`);
    this.notifyFn?.(callingNumber, 'forwarding', { target, callId });

    try {
      const { uas, uac } = await this.srf.createB2BUA(req, res, contactUri, {
        proxyRequestHeaders: ['to', 'from', 'call-id', 'cseq', 'max-forwards', 'content-type'],
        proxyResponseHeaders: ['contact', 'allow', 'supported'],
      });

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
      if (!res.finalResponseSent) res.send(503);
    }
  }
}
