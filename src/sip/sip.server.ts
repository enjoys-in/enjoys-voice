import Srf from 'drachtio-srf';
import crypto from 'crypto';
import { config } from '@/core';
import { DatabaseService, TrunkService } from '@/services';
import { IVRSystem } from './ivr.system';

export class SipServer {
  private srf: InstanceType<typeof Srf>;
  private connected = false;
  private ivr: IVRSystem | null = null;

  constructor(
    private db: DatabaseService,
    private trunk: TrunkService,
  ) {
    this.srf = new Srf();
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
    this.srf.register((req: any, res: any) => {
      try {
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
          this.db.unregisterUser(user.extension);
          res.send(200, { headers: { 'Contact': contact, 'Expires': '0' } });
          console.log(`🔴 SIP: ${user.name} unregistered`);
        } else {
          this.db.registerUser(user.extension, contact, expires);
          res.send(200, { headers: { 'Contact': contact, 'Expires': expires.toString() } });
          console.log(`✅ SIP: ${user.name} registered at ${contact}`);
        }
      } catch (err: any) {
        console.error('❌ SIP REGISTER error:', err.message, err.stack);
        res.send(500);
      }
    });
  }

  private handleInvite(): void {
    this.srf.invite(async (req: any, res: any) => {
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

      // IVR routing
      if (this.shouldRouteToIvr(calledNumber)) {
        console.log(`🎙️ IVR: Routing call`);
        await this.ivr!.handleIncomingCall(req, res);
        return;
      }

      // Local extension
      const reg = this.db.getRegistration(calledNumber);
      if (reg) {
        await this.routeToExtension(req, res, reg.contact, callId);
        return;
      }

      // External via trunk
      if (this.trunk.isEnabled) {
        console.log(`📞 Trunk: Routing to ${calledNumber}`);
        const ok = await this.trunk.routeCall(this.srf, req, res, calledNumber);
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

  private shouldRouteToIvr(calledNumber: string): boolean {
    if (!this.ivr?.isConnected() || !config.ivr.enabled) return false;
    return /^(18\d{8}|1800\d+|800\d+|888\d+|877\d+|866\d+|855\d+|844\d+|833\d+|5555\d*|5000)$/.test(calledNumber);
  }

  private async routeToExtension(req: any, res: any, contact: string, callId: string): Promise<void> {
    try {
      console.log(`📞 Routing call via B2BUA to contact: ${contact}`);
      console.log(`📞 Caller SDP length: ${req.body?.length || 0}`);
      console.log(`📞 Request URI: ${req.uri}`);

      // Use B2BUA to bridge — drachtio routes INVITE through callee's existing WS connection
      const { uas, uac } = await this.srf.createB2BUA(req, res, contact, {
        proxyRequestHeaders: ['to', 'from', 'call-id', 'cseq', 'max-forwards', 'content-type'],
        proxyResponseHeaders: ['contact', 'allow', 'supported'],
      });

      console.log(`✅ Call connected: ${req.callingNumber} → bridged via B2BUA`);

      const onDestroy = () => {
        this.db.updateCall(callId, { status: 'ended', endTime: new Date().toISOString() });
      };
      uas.on('destroy', () => { uac.destroy(); onDestroy(); });
      uac.on('destroy', () => { uas.destroy(); onDestroy(); });

      this.db.updateCall(callId, { status: 'answered' });
    } catch (err: any) {
      console.error('❌ Call routing failed:', err.message);
      console.error('❌ Full error:', JSON.stringify(err, null, 2));
      if (err.status) console.error(`❌ SIP response status: ${err.status}`);
      if (!res.finalResponseSent) res.send(503);
      this.db.updateCall(callId, { status: 'failed' });
    }
  }
}
