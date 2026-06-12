import Srf from 'drachtio-srf';
import Mrf from 'drachtio-fsmrf';
import crypto from 'crypto';
import { config, IVRCallState, Department } from '@/core';
import { DatabaseService } from '@/services';

const DEFAULT_DEPARTMENTS: Department[] = [
  { id: 'sales', name: 'Sales', nameHi: 'बिक्री', agents: ['1001', '1002'], queueName: 'sales_queue', maxWait: 120, priority: 2 },
  { id: 'support', name: 'Tech Support', nameHi: 'तकनीकी सहायता', agents: ['1002', '1003'], queueName: 'support_queue', maxWait: 120, priority: 2 },
  { id: 'billing', name: 'Billing', nameHi: 'बिलिंग', agents: ['1001'], queueName: 'billing_queue', maxWait: 120, priority: 2 },
  { id: 'care', name: 'Customer Care', nameHi: 'ग्राहक सेवा', agents: ['1001', '1002', '1003'], queueName: 'care_queue', maxWait: 180, priority: 1 },
];

export class IVRSystem {
  private mrf: InstanceType<typeof Mrf>;
  private ms: any = null;
  private departments: Department[];
  private activeCalls = new Map<string, IVRCallState>();
  private recordings: { path: string; callId: string; time: string }[] = [];
  private reconnecting = false;

  constructor(
    private srf: InstanceType<typeof Srf>,
    private db: DatabaseService,
    departments?: Department[],
  ) {
    this.mrf = new Mrf(srf);
    this.departments = departments || DEFAULT_DEPARTMENTS;
  }

  async initialize(): Promise<boolean> {
    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        this.ms = await this.mrf.connect({
          address: config.freeswitch.host,
          port: config.freeswitch.port,
          secret: config.freeswitch.secret,
          listenAddress: '0.0.0.0',
          listenPort: config.freeswitch.listenPort,
          advertisedAddress: config.freeswitch.listenAddress,
          profile: 'drachtio_mrf',
        });
        this.attachConnectionListeners(this.ms);
        console.log('✅ IVR: Connected to FreeSWITCH');
        return true;
      } catch (err: any) {
        console.warn(`⚠️ IVR: Attempt ${attempt}/${maxRetries} failed:`, err?.message);
        if (attempt < maxRetries) await new Promise(r => setTimeout(r, 2000));
      }
    }
    return false;
  }

  /**
   * Drop the media-server reference ONLY when the underlying ESL connection to
   * FreeSWITCH actually dies, then auto-reconnect. A single failed call must
   * never tear down the shared connection (that previously caused every later
   * call to 503 / fall through to 480).
   */
  private attachConnectionListeners(ms: any): void {
    const onDown = (why: string) => {
      if (this.ms !== ms) return; // stale listener for a replaced connection
      console.warn(`⚠️ IVR: FreeSWITCH connection lost (${why}); will reconnect`);
      this.ms = null;
      this.scheduleReconnect();
    };
    ms.on('end', () => onDown('end'));
    ms.on('error', (e: any) => onDown(e?.message || 'error'));
  }

  private scheduleReconnect(): void {
    if (this.reconnecting) return;
    this.reconnecting = true;
    const attempt = async () => {
      const ok = await this.initialize();
      this.reconnecting = false;
      if (ok) console.log('✅ IVR: Reconnected to FreeSWITCH');
      else setTimeout(() => { this.reconnecting = true; attempt(); }, 5000);
    };
    setTimeout(attempt, 2000);
  }

  /** Ensure a live media-server connection, reconnecting on demand. */
  private async ensureConnected(): Promise<boolean> {
    if (this.ms) return true;
    return this.initialize();
  }

  isConnected(): boolean {
    return !!this.ms;
  }

  getActiveCalls(): IVRCallState[] {
    return Array.from(this.activeCalls.values());
  }

  getDepartments(): Department[] {
    return this.departments;
  }

  getRecordings() {
    return this.recordings;
  }

  async handleIncomingCall(req: any, res: any, existingCallId?: string): Promise<void> {
    const callId = existingCallId || crypto.randomUUID();
    const callerNumber = req.callingNumber || 'unknown';
    const calledNumber = req.calledNumber || 'unknown';

    const state: IVRCallState = {
      callId, callerNumber, calledNumber,
      language: 'en', status: 'ivr',
      startTime: new Date().toISOString(),
    };
    this.activeCalls.set(callId, state);

    // Only create a new log entry if the caller (SIP server) didn't already
    // log this call. Reusing the id avoids duplicate recents (ringing+failed).
    if (!existingCallId) {
      this.db.logCall({
        id: callId, from: callerNumber, to: calledNumber,
        fromName: callerNumber, status: 'ringing',
        direction: 'inbound', startTime: state.startTime,
      });
    }

    if (!(await this.ensureConnected())) {
      res.send(503);
      this.db.updateCall(callId, { status: 'failed' });
      return;
    }

    try {
      const { endpoint, dialog } = await this.ms.connectCaller(req, res);
      // Play welcome and collect DTMF
      await endpoint.play('say:Welcome to CallNet. Press 1 for English, 2 for Hindi.');
      const { dtmf } = await endpoint.waitForDtmf(10000);

      if (dtmf === '2') state.language = 'hi';

      // Department menu
      const menuPrompt = state.language === 'hi'
        ? 'say:hi:1 बिक्री, 2 तकनीकी सहायता, 3 बिलिंग, 9 ग्राहक सेवा'
        : 'say:Press 1 for Sales, 2 for Support, 3 for Billing, 9 for Customer Care';
      await endpoint.play(menuPrompt);
      const { dtmf: dept } = await endpoint.waitForDtmf(10000);

      const deptMap: Record<string, string> = { '1': 'sales', '2': 'support', '3': 'billing', '9': 'care' };
      state.department = deptMap[dept] || 'care';
      state.status = 'queued';

      // Play hold music while waiting for agent
      await endpoint.play(config.sounds.holdMusic);

      this.db.updateCall(callId, { status: 'answered' });
      console.log(`🎙️ IVR: ${callerNumber} → ${state.department} (${state.language})`);
    } catch (err: any) {
      console.error('❌ IVR error:', err.message);
      this.activeCalls.delete(callId);
      this.db.updateCall(callId, { status: 'failed' });
      // Fail only THIS call. Do NOT tear down the shared media-server
      // connection — that is handled by the lifecycle listeners, which also
      // trigger an auto-reconnect. Nulling here previously disabled the IVR
      // for every subsequent call (503 → fall-through to 480).
      if (!res.finalResponseSent) {
        res.send(503, 'Service Unavailable');
      }
    }
  }

  async transferCall(callId: string, targetExtension: string, attended: boolean): Promise<boolean> {
    const call = this.activeCalls.get(callId);
    if (!call) return false;

    console.log(`🔀 IVR Transfer: ${callId} → ${targetExtension} (${attended ? 'attended' : 'blind'})`);
    call.status = 'connected';
    return true;
  }
}
