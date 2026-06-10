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
          listenPort: 0,
          advertisedAddress: config.freeswitch.listenAddress,
          profile: 'drachtio_mrf',
        });
        console.log('✅ IVR: Connected to FreeSWITCH');
        return true;
      } catch (err: any) {
        console.warn(`⚠️ IVR: Attempt ${attempt}/${maxRetries} failed:`, err?.message);
        if (attempt < maxRetries) await new Promise(r => setTimeout(r, 2000));
      }
    }
    return false;
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

  async handleIncomingCall(req: any, res: any): Promise<void> {
    const callId = crypto.randomUUID();
    const callerNumber = req.callingNumber || 'unknown';
    const calledNumber = req.calledNumber || 'unknown';

    const state: IVRCallState = {
      callId, callerNumber, calledNumber,
      language: 'en', status: 'ivr',
      startTime: new Date().toISOString(),
    };
    this.activeCalls.set(callId, state);

    this.db.logCall({
      id: callId, from: callerNumber, to: calledNumber,
      fromName: callerNumber, status: 'ringing',
      direction: 'inbound', startTime: state.startTime,
    });

    if (!this.ms) {
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
      // Send error response if call wasn't answered yet
      if (!res.finalResponseSent) {
        res.send(503, 'Service Unavailable');
      }
      // Mark IVR as disconnected so future calls skip IVR
      this.ms = null;
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
