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

    let endpoint: Mrf.Endpoint | undefined;
    let dialog: Srf.Dialog | undefined;
    const startedAt = Date.now();

    try {
      ({ endpoint, dialog } = await this.ms!.connectCaller(req, res));

      const greeting = `The person you are trying to reach is unavailable. `
        + `Please leave a message after the tone. Press zero when you are finished.`;
      await endpoint.speak({ ttsEngine: 'flite', voice: 'slt', text: greeting });
      // Short beep tone.
      await endpoint.play('tone_stream://%(500,0,800)');

      // Stop recording when the caller presses 0 (or #).
      await endpoint.execute('set', 'playback_terminators=0#');
      // Typed record() helper (same underlying `record` app as execute('record',…))
      // but it hands back FreeSWITCH's own stats. We use recordSeconds for the
      // duration so it reflects ONLY the message — not the greeting/beep that
      // played first, which wall-clock (Date.now() - startedAt) would include.
      const rec = await endpoint.record(fsPath, {
        timeLimitSecs: config.voicemail.maxSec,
        silenceThresh: 200,
        silenceHits: 5,
      });

      const duration = rec.recordSeconds
        ? Math.round(Number(rec.recordSeconds))
        : Math.round((Date.now() - startedAt) / 1000);

      await this.db.addVoicemail({
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

  /**
   * Answer the caller, play a short "the person you're calling is unavailable,
   * please try again later" announcement, then hang up. Used as the final
   * fallback when an offline/unreachable callee has no PSTN or voicemail option,
   * so the caller hears a clear spoken reason instead of a bare SIP error.
   *
   * Safe to call after a failed B2BUA attempt as long as the caller's INVITE
   * was not already answered (the SIP server keeps the A-leg open by setting
   * `passFailure: false`), since connectCaller answers it here.
   */
  async playUnavailable(req: any, res: any, message?: string): Promise<void> {
    if (!(await this.ensureConnected())) {
      if (!res.finalResponseSent) res.send(480, 'Temporarily Unavailable');
      return;
    }

    let endpoint: Mrf.Endpoint | undefined;
    let dialog: Srf.Dialog | undefined;
    try {
      ({ endpoint, dialog } = await this.ms!.connectCaller(req, res));
      await this.prepareVoice(endpoint);
      const text = message
        || 'The person you are trying to reach is not available right now. '
        + 'Please try again later.';
      await this.playSafe(endpoint, `say:${text}`);
    } catch (err: any) {
      console.error('❌ Announcement error:', err?.message || err);
      if (res && !res.finalResponseSent) res.send(480, 'Temporarily Unavailable');
    } finally {
      try { endpoint?.destroy(); } catch { /* noop */ }
      try { await dialog?.destroy?.(); } catch { /* noop */ }
    }
  }

  /**
   * Join the calling user into a Microsoft Teams meeting via Audio-Conferencing
   * dial-in. We answer the user's A-leg onto FreeSWITCH, originate a B-leg to
   * the meeting's PSTN dial-in number through the trunk (media anchored on FS so
   * we can inject DTMF), auto-enter the Conference ID once Teams' greeting is
   * ready, then bridge the two legs. The user appears in the meeting as an
   * ordinary phone participant — no Teams/Azure licence or SDK on our side.
   *
   * The trunk leg is a 3pcc/park-and-bridge: FreeSWITCH provides the offer SDP,
   * drachtio carries SIP + trunk auth to the PSTN, then we re-point FS media at
   * the answer. The bridged legs live until either side hangs up; teardown is
   * driven by the destroy listeners (no finally-cleanup, mirroring routeCall).
   *
   * @returns true once bridged (or a final SIP response was sent), false on a
   *   pre-answer failure where the caller should fall through.
   */
  async joinTeamsMeeting(
    req: any,
    res: any,
    srf: InstanceType<typeof Srf>,
    trunk: { createOutboundLeg: (srf: any, number: string, localSdp: string, callerId?: string) => Promise<any | null> },
    dialInNumber: string,
    conferenceId: string,
  ): Promise<boolean> {
    if (!(await this.ensureConnected())) {
      if (!res.finalResponseSent) res.send(480, 'Temporarily Unavailable');
      return false;
    }

    let aLeg: Mrf.Endpoint | undefined;
    let bLeg: Mrf.Endpoint | undefined;
    let dialog: Srf.Dialog | undefined;
    let uac: any;
    let torndown = false;

    // Tear down everything exactly once, regardless of which leg ends first.
    const teardown = () => {
      if (torndown) return;
      torndown = true;
      try { uac?.destroy?.(); } catch { /* noop */ }
      try { bLeg?.destroy?.(); } catch { /* noop */ }
      try { aLeg?.destroy?.(); } catch { /* noop */ }
      try { dialog?.destroy?.(); } catch { /* noop */ }
    };

    try {
      // A-leg: answer the user onto FreeSWITCH (handles WebRTC DTLS-SRTP).
      ({ endpoint: aLeg, dialog } = await this.ms!.connectCaller(req, res));
      await this.prepareVoice(aLeg);
      await this.playSafe(aLeg, 'say:Connecting you to the meeting. Please hold.');

      // B-leg: a 3pcc FreeSWITCH endpoint provides the offer; drachtio dials the
      // Teams PSTN number through the trunk; then we re-point FS at the answer.
      bLeg = await this.ms!.createEndpoint();
      uac = await trunk.createOutboundLeg(srf, dialInNumber, bLeg.local.sdp || '');
      if (!uac) {
        await this.playSafe(aLeg, 'say:The meeting service is unavailable. Goodbye.');
        teardown();
        return true;
      }
      await bLeg.modify(uac.remote?.sdp || '');

      // Teams won't accept digits until its greeting starts — wait, then DTMF
      // the Conference ID (trailing # submits it).
      await new Promise((r) => setTimeout(r, config.teams.dtmfDelayMs));
      try {
        await bLeg.execute('send_dtmf', `${conferenceId}#`);
      } catch (err: any) {
        console.warn(`⚠️ Teams: send_dtmf failed: ${err?.message}`);
      }

      // Bridge the user to Teams; tear both down when either hangs up.
      uac.on('destroy', teardown);
      dialog.on('destroy', teardown);
      bLeg.on('destroy', teardown);
      aLeg.on('destroy', teardown);

      await aLeg.bridge(bLeg);
      console.log(`✅ Teams: bridged caller into meeting ${conferenceId} via ${dialInNumber}`);
      return true;
    } catch (err: any) {
      console.error('❌ Teams join error:', err?.message || err);
      try {
        if (aLeg && !torndown) await this.playSafe(aLeg, 'say:Sorry, we could not join the meeting. Goodbye.');
      } catch { /* noop */ }
      teardown();
      if (res && !res.finalResponseSent) res.send(480, 'Temporarily Unavailable');
      return true;
    }
  }

  /**
   * Play a file/prompt, logging it and tolerating a missing file.
   *
   * `endpoint.play()` throws "File Not Found" when FreeSWITCH can't locate the
   * file (e.g. a misconfigured sound path). A single missing prompt must not
   * abort the whole call, so we log which file failed and carry on.
   */
  private async playSafe(endpoint: Mrf.Endpoint, file: string): Promise<void> {
    console.log(`   ▶️ play: ${file}`);
    try {
      await endpoint.play(file);
    } catch (err: any) {
      console.warn(`   ⚠️ play failed for "${file}": ${err?.message}`);
    }
  }

  /**
   * Configure a calmer, clearer TTS voice and add a short lead-in silence.
   *
   * The default flite voice ("kal") is fast and robotic; "slt" is clearer.
   * Flite has NO true speech-rate control, so for a genuinely slower/natural
   * pace the real fix is pre-recorded prompt files (see audit notes). The
   * 500ms silence prevents the first word being clipped while RTP comes up.
   */
  private async prepareVoice(endpoint: Mrf.Endpoint): Promise<void> {
    try {
      await endpoint.execute('set', 'tts_engine=flite');
      await endpoint.execute('set', 'tts_voice=slt');
      await endpoint.play('silence_stream://500');
    } catch (err: any) {
      console.warn(`⚠️ IVR: prepareVoice failed: ${err?.message}`);
    }
  }

  /**
   * Play a prompt and collect a single DTMF digit, with barge-in.
   *
   * The ENTIRE prompt is played to the caller. They can either listen to all
   * of it and then press a key, OR — if they already know the menu — barge in
   * and press a key at any moment, which stops the prompt instantly and
   * advances to the next step. If no key is pressed, the prompt replays up to
   * `tries` times before giving up (returns '').
   *
   * We deliberately do NOT use playCollect()/play_and_get_digits here: that
   * FreeSWITCH app parses its arguments by spaces, so a `say:` prompt that
   * contains spaces (every one of our menus) corrupts the argument parsing —
   * only the first word is spoken and digit collection silently fails. Playing
   * the prompt with play() (the whole string is a single file arg) and reading
   * the digit from the channel's `dtmf` events avoids that entirely.
   */
  private async promptAndCollect(
    endpoint: Mrf.Endpoint,
    prompt: string,
    opts: { waitMs?: number; tries?: number; valid?: string; label?: string } = {},
  ): Promise<string> {
    const waitMs = opts.waitMs ?? 7000;
    const tries = Math.max(1, opts.tries ?? 2);
    const label = opts.label || 'prompt';

    // Let any DTMF key stop the prompt the instant it is pressed (barge-in).
    await endpoint.execute('set', 'playback_terminators=0123456789*#');

    for (let attempt = 1; attempt <= tries; attempt++) {
      console.log(`   🎚️ ${label}: prompt attempt ${attempt}/${tries}`);
      const digit = await new Promise<string>((resolve) => {
        let settled = false;
        let timer: ReturnType<typeof setTimeout> | undefined;

        const finish = (d: string) => {
          if (settled) return;
          settled = true;
          if (timer) clearTimeout(timer);
          endpoint.removeListener('dtmf', onDtmf);
          resolve(d);
        };

        const onDtmf = (evt: Mrf.DtmfEvent) => {
          console.log(`   ⌨️ ${label}: DTMF received "${evt.dtmf}"`);
          finish(evt.dtmf);
        };
        endpoint.on('dtmf', onDtmf);

        // Play the WHOLE prompt. A barge-in keypress resolves via onDtmf
        // before playback finishes; otherwise we wait waitMs for a key after.
        endpoint.play(prompt)
          .then(() => {
            if (settled) return;            // caller barged in mid-prompt
            timer = setTimeout(() => finish(''), waitMs);
          })
          .catch((e: any) => {
            console.warn(`   ⚠️ ${label}: prompt playback failed: ${e?.message}`);
            finish('');
          });
      });

      if (digit && (!opts.valid || opts.valid.includes(digit))) {
        console.log(`   ✅ ${label}: accepted "${digit}"`);
        return digit;
      }
      if (digit) console.log(`   ↩️ ${label}: "${digit}" not valid, retrying`);
      else console.log(`   ⏱️ ${label}: no input (${attempt < tries ? 'retrying' : 'giving up'})`);
    }

    return '';
  }

  async handleIncomingCall(req: any, res: any, existingCallId?: string): Promise<void> {
    const callId = existingCallId || crypto.randomUUID();
    const callerNumber = req.callingNumber || 'unknown';
    const calledNumber = req.calledNumber || 'unknown';

    console.log(`\n📞 IVR: incoming call [${callId}]`);
    console.log(`   from=${callerNumber} to=${calledNumber} reusedId=${!!existingCallId}`);

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
        fromName: this.db.getUser(callerNumber)?.name || callerNumber, status: 'ringing',
        direction: 'inbound', startTime: state.startTime,
      });
    }

    if (!(await this.ensureConnected())) {
      console.warn(`⚠️ IVR: media server unavailable; rejecting [${callId}] with 503`);
      res.send(503);
      this.db.updateCall(callId, { status: 'failed' });
      return;
    }

    let endpoint: Mrf.Endpoint | undefined;
    let dialog: Srf.Dialog | undefined;

    try {
      console.log(`🔗 IVR: answering & connecting caller to media server [${callId}]`);
      ({ endpoint, dialog } = await this.ms!.connectCaller(req, res));
      console.log(`✅ IVR: media connected, channel=${endpoint.uuid} [${callId}]`);

      // Calmer, clearer TTS voice + brief lead-in silence (see prepareVoice).
      await this.prepareVoice(endpoint);

      // One-time greeting. Played ONCE so it is NOT repeated on menu retries.
      console.log(`🗣️ IVR: greeting [${callId}]`);
      await this.playSafe(endpoint, 'say:Welcome to Enjoys Voice.');

      // Language menu. The FULL prompt is played; the caller may listen to all
      // of it and then choose, or barge in and press a key at any point to jump
      // ahead. Replays once if nothing is pressed.
      console.log(`🌐 IVR: language menu [${callId}]`);
      const lang = await this.promptAndCollect(
        endpoint,
        'say:Press 1 for English. Press 2 for Hindi.',
        { valid: '12', tries: 2, waitMs: 7000, label: 'language' },
      );
      if (lang === '2') state.language = 'hi';
      console.log(`🌐 IVR: language=${state.language} [${callId}]`);

      // Department menu
      const menuPrompt = state.language === 'hi'
        ? 'say:hi:1 बिक्री. 2 तकनीकी सहायता. 3 बिलिंग. 9 ग्राहक सेवा.'
        : 'say:Press 1 for Sales. Press 2 for Support. Press 3 for Billing. Press 9 for Customer Care.';
      console.log(`🏢 IVR: department menu [${callId}]`);
      const dept = await this.promptAndCollect(
        endpoint,
        menuPrompt,
        { valid: '1239', tries: 2, waitMs: 7000, label: 'department' },
      );

      const deptMap: Record<string, string> = { '1': 'sales', '2': 'support', '3': 'billing', '9': 'care' };
      state.department = deptMap[dept] || 'care';
      state.status = 'queued';

      this.db.updateCall(callId, { status: 'answered' });
      console.log(`🎙️ IVR: ${callerNumber} → ${state.department} (${state.language}) [${callId}]`);

      // Start hold music while waiting for an agent. Fire-and-forget: MOH loops
      // forever, so we must NOT await it (that would block this handler). The
      // call stays up; an agent transfer later stops MOH and bridges the legs.
      console.log(`🎵 IVR: hold music (${config.sounds.holdMusic}) [${callId}]`);
      endpoint.executeAsync('playback', config.sounds.holdMusic);
    } catch (err: any) {
      console.error(`❌ IVR error [${callId}]:`, err?.message || err);
      this.activeCalls.delete(callId);
      this.db.updateCall(callId, { status: 'failed' });

      // End THIS call cleanly. connectCaller already answered (200 OK), so an
      // error after that means we must HANG UP the established leg — destroy
      // the endpoint and dialog. (If we never answered, send 503 instead.)
      // We deliberately do NOT tear down the shared media-server connection;
      // that is handled by the lifecycle listeners, which also auto-reconnect.
      if (!res.finalResponseSent) {
        res.send(503, 'Service Unavailable');
      }
      try { await dialog?.destroy?.(); } catch { /* noop */ }
      try { await endpoint?.destroy?.(); } catch { /* noop */ }
      console.log(`🔚 IVR: call ended after error [${callId}]`);
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
