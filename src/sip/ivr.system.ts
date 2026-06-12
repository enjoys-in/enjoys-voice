import Srf from 'drachtio-srf';
import Mrf from 'drachtio-fsmrf';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
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
  private ms: Mrf.MediaServer | null = null;
  private departments: Department[];
  private activeCalls = new Map<string, IVRCallState>();
  private recordings: { path: string; callId: string; time: string }[] = [];
  private reconnecting = false;
  /** Optional callback to notify a user of events (e.g. new voicemail) via WS. */
  private notifyFn?: (extension: string, event: string, data?: any) => void;

  constructor(
    private srf: InstanceType<typeof Srf>,
    private db: DatabaseService,
    departments?: Department[],
  ) {
    this.mrf = new Mrf(srf);
    this.departments = departments || DEFAULT_DEPARTMENTS;
  }

  /** Register a callback to push events (e.g. new voicemail) to users. */
  setNotifier(fn: (extension: string, event: string, data?: any) => void): void {
    this.notifyFn = fn;
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

  /**
   * Answer an offline-user call and capture a voicemail.
   * Plays an "unavailable" announcement, a beep, then records until the
   * caller presses 0 or the max duration is reached. Stores the message
   * for the mailbox owner and notifies them over WebSocket.
   */
  async recordVoicemail(
    req: any,
    res: any,
    mailbox: string,
    callerNumber: string,
    fromName: string,
  ): Promise<boolean> {
    if (!config.voicemail.enabled) return false;

    if (!(await this.ensureConnected())) {
      if (!res.finalResponseSent) res.send(480, 'Temporarily Unavailable');
      return false;
    }

    const id = crypto.randomUUID();
    // Organize recordings as <mailbox>/<YYYYMMDD>/vm_<ts>.wav so messages are
    // easy to browse per-user/per-day instead of piling up in one flat folder.
    const now = new Date();
    const dateDir = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const relDir = `${mailbox}/${dateDir}`;
    const fileName = `vm_${Date.now()}.wav`;
    const relPath = `${relDir}/${fileName}`;
    const fsPath = `${config.voicemail.fsDir}/${relPath}`;

    // Ensure the shared recordings subdirectory exists (same bind mount the
    // FreeSWITCH container writes into), so the record app can create the file.
    try {
      fs.mkdirSync(path.resolve(config.voicemail.hostDir, relDir), { recursive: true });
    } catch { /* best-effort */ }

    let endpoint: any;
    let dialog: any;
    const startedAt = Date.now();

    try {
      ({ endpoint, dialog } = await this.ms!.connectCaller(req, res));

      const greeting = `say:The person you are trying to reach is unavailable. `
        + `Please leave a message after the tone. Press zero when you are finished.`;
      await endpoint.play(greeting);
      // Short beep tone.
      await endpoint.play('tone_stream://%(500,0,800)');

      // Stop recording when the caller presses 0 (or #).
      await endpoint.execute('set', 'playback_terminators=0#');
      // record: <path> <max-secs> <silence-threshold> <silence-hits>
      await endpoint.execute('record', `${fsPath} ${config.voicemail.maxSec} 200 5`);

      const duration = Math.round((Date.now() - startedAt) / 1000);

      this.db.addVoicemail({
        id,
        mailbox,
        from: callerNumber,
        fromName: fromName || callerNumber,
        file: relPath,
        duration,
        createdAt: new Date().toISOString(),
        read: false,
      });

      this.notifyFn?.(mailbox, 'voicemail', {
        id,
        from: callerNumber,
        fromName: fromName || callerNumber,
        duration,
        createdAt: new Date().toISOString(),
      });

      console.log(`📭 Voicemail saved for ${mailbox} from ${callerNumber} (${duration}s)`);
      return true;
    } catch (err: any) {
      console.error('❌ Voicemail error:', err.message);
      if (res && !res.finalResponseSent) res.send(480, 'Temporarily Unavailable');
      return false;
    } finally {
      try { endpoint?.destroy(); } catch { /* noop */ }
      try { await dialog?.destroy?.(); } catch { /* noop */ }
    }
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
      const { endpoint, dialog } = await this.ms!.connectCaller(req, res);

      // One-time greeting. Played ONCE via play() so it is NOT repeated when
      // the caller doesn't press a key in time — otherwise playCollect's retry
      // would replay the whole prompt and the caller hears "welcome…welcome…".
      await endpoint.play('say:Welcome to Enjoys Voice.');

      // Language menu. playCollect plays the menu prompt AND collects a digit in
      // one step, with barge-in (the caller can press a key before it finishes).
      // Only the short menu (not the greeting) repeats on no-input retry.
      const { digits: lang } = await endpoint.playCollect({
        file: 'say:Press 1 for English. Press 2 for Hindi.',
        min: 1, max: 1, tries: 2, timeout: 8000, digitTimeout: 5000, terminators: '#',
      });

      if (lang === '2') state.language = 'hi';

      // Department menu
      const menuPrompt = state.language === 'hi'
        ? 'say:hi:1 बिक्री. 2 तकनीकी सहायता. 3 बिलिंग. 9 ग्राहक सेवा.'
        : 'say:Press 1 for Sales. Press 2 for Support. Press 3 for Billing. Press 9 for Customer Care.';
      const { digits: dept } = await endpoint.playCollect({
        file: menuPrompt,
        min: 1, max: 1, tries: 2, timeout: 8000, digitTimeout: 5000, terminators: '#',
      });

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
