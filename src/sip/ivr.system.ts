import Srf from 'drachtio-srf';
import Mrf from 'drachtio-fsmrf';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { config, IVRCallState, Department } from '@/core';
import { DatabaseService } from '@/services';
import { sendConnectorEmail } from '@/services';
import { runFlow, type FlowRunnerContext, type FlowRunnerHandlers, type FlowResult } from './ivr/flow-runner';
import type { IvrFlowGraph } from './ivr/flow.types';
import { DecisionType, UnavailableReason, type RoutingOrchestrator } from '@/modules/routing';

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
    private routing?: RoutingOrchestrator,
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
  private attachConnectionListeners(ms: Mrf.MediaServer): void {
    const onDown = (why: string) => {
      if (this.ms !== ms) return; // stale listener for a replaced connection
      console.warn(`⚠️ IVR: FreeSWITCH connection lost (${why}); will reconnect`);
      this.ms = null;
      this.scheduleReconnect();
    };
    ms.on('connect', () => console.log('✅ IVR: FreeSWITCH ESL connected'));
    ms.on('ready', () => console.log('✅ IVR: FreeSWITCH ESL ready'));
    ms.on('end', () => onDown('end'));
    ms.on('error', (e: any) => onDown(e?.message || 'error'));
    ms.on('channel::open', () => console.log('✅ IVR: FreeSWITCH channel opened'));
    ms.on('channel::close', () => console.log('ℹ️ IVR: FreeSWITCH channel closed'));
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
    req: Srf.SrfRequest,
    res: Srf.SrfResponse,
    mailbox: string,
    callerNumber: string,
    fromName: string,
  ): Promise<boolean> {
    console.log(`\n📭 Voicemail: incoming for mailbox=${mailbox} from=${callerNumber}`);
    if (!config.voicemail.enabled) {
      return false;
    }
    if (!(await this.ensureConnected())) {
      console.warn('   ⚠️ Voicemail: media server unavailable; replying 480');
      if (!res.finalResponseSent) res.send(480, 'Temporarily Unavailable');
      return false;
    }

    let endpoint: Mrf.Endpoint | undefined;
    let dialog: Srf.Dialog | undefined;

    try {
      ({ endpoint, dialog } = await this.ms!.connectCaller(req, res));
      console.log(`   ✅ Voicemail: media connected, channel=${endpoint.uuid}`);

      return await this.captureVoicemail(endpoint, mailbox, callerNumber, fromName);
    } catch (err: any) {
      console.log(err)
      console.error('❌ Voicemail error:', err.message);
      if (res && !res.finalResponseSent) res.send(480, 'Temporarily Unavailable');
      return false;
    } finally {
      try { endpoint?.destroy(); } catch { /* noop */ }
      try { await dialog?.destroy?.(); } catch { /* noop */ }
    }
  }

  /**
   * Record a voicemail on an ALREADY-CONNECTED endpoint (the caller's A-leg is
   * answered onto FreeSWITCH and `res` has been responded). Plays a greeting
   * (a custom prompt or the default "unavailable" message), a beep, then records
   * until the caller presses 0/# or the limit is reached, persists the message
   * and notifies the mailbox owner. Shared by the offline-user fallback
   * (recordVoicemail, which does the connectCaller first) and the IVR flow
   * `voicemail` node. Never touches `res`.
   */
  private async captureVoicemail(
    endpoint: Mrf.Endpoint,
    mailbox: string,
    callerNumber: string,
    fromName: string,
    opts: { greeting?: string; maxSeconds?: number } = {},
  ): Promise<boolean> {
    if (!config.voicemail.enabled) return false;

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

    const startedAt = Date.now();

    // Set the TTS engine so a `say:` greeting renders, then play the greeting
    // (a custom voicemail-node prompt, or the default message) and a beep.
    try {
      await endpoint.execute('set', `tts_engine=${config.tts.engine}`);
      await endpoint.execute('set', `tts_voice=${config.tts.voice}`);
    } catch { /* best-effort */ }

    const greeting = opts.greeting
      || 'say:The person you are trying to reach is unavailable. '
      + 'Please leave a message after the tone. Press zero when you are finished.';
    console.log(`   🗣️ Voicemail: playing greeting for mailbox=${mailbox}`);
    await this.playSafe(endpoint, greeting);
    // Short beep tone.
    console.log('   🔔 Voicemail: playing beep');
    await this.playSafe(endpoint, 'tone_stream://%(500,0,800)');

    // Stop recording when the caller presses 0 (or #).
    await endpoint.execute('set', 'playback_terminators=0#');
    console.log(`   ⏺️ Voicemail: recording → ${fsPath}`);
    // Typed record() helper (same underlying `record` app as execute('record',…))
    // but it hands back FreeSWITCH's own stats. We use recordSeconds for the
    // duration so it reflects ONLY the message — not the greeting/beep that
    // played first, which wall-clock (Date.now() - startedAt) would include.
    const rec = await endpoint.record(fsPath, {
      timeLimitSecs: opts.maxSeconds ?? config.voicemail.maxSec,
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

      // Bridge the user to Teams. If the Teams/trunk leg drops within a few
      // seconds of bridging, the Conference ID was most likely wrong or expired
      // (Teams rejects it and hangs up) — tell the caller instead of dropping
      // them silently. A normal hang-up later just tears down without a prompt.
      let bridgedAt = 0;
      let failureHandled = false;
      const onTrunkEnd = () => {
        // Re-entrant guard: tearing down one leg destroys the others, which
        // re-fires this handler; only the first invocation may play a prompt.
        if (failureHandled || torndown) { teardown(); return; }
        failureHandled = true;
        const earlyFail = bridgedAt > 0 && Date.now() - bridgedAt < config.teams.joinFailMs;
        if (earlyFail && aLeg) {
          // Fire-and-forget: play to the still-connected caller, then tear down.
          this.playSafe(aLeg, 'say:Sorry, we could not join the meeting. Please check the conference ID and try again. Goodbye.')
            .catch(() => { /* noop */ })
            .finally(teardown);
          return;
        }
        teardown();
      };

      uac.on('destroy', onTrunkEnd);
      dialog.on('destroy', onTrunkEnd);
      bLeg.on('destroy', onTrunkEnd);
      aLeg.on('destroy', teardown); // caller hung up → straight teardown, no prompt

      bridgedAt = Date.now();
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
   * Originate TWO outbound PSTN legs and bridge them — a true server-driven
   * click-to-call "callback". Unlike {@link joinTeamsMeeting} there is NO inbound
   * caller: both legs are dialed OUT through the trunk and anchored on FreeSWITCH
   * (each FS endpoint provides the offer SDP; we re-point it at the PSTN answer),
   * so the media is relayed/transcoded FS-side and neither party has to be a
   * registered SIP endpoint.
   *
   * Sequencing mirrors a standard callback: the locked `destination` (the
   * business/agent line) is rung FIRST; only once it answers is the visitor's
   * `customerNumber` dialed, then the two are bridged. Ringing the destination
   * first means we never ring a customer just to connect them to a phone that
   * turns out to be unreachable. `createOutboundLeg` resolves on 200 OK, so each
   * `await` below already implies "answered".
   *
   * Fire-and-forget by design: the HTTP route pre-validates and kicks this off,
   * so the returned result exists purely for logging — the bridged call then
   * lives on its own destroy listeners until either side hangs up (teardown
   * fires exactly once regardless of which leg ends first, mirroring routeCall).
   *
   * @returns ok=true once both legs are bridged; ok=false (with a reason) on any
   *   pre-bridge failure (media down, either leg not answered, internal error).
   */
  async bridgePstnToPstn(
    trunk: { isEnabled: boolean; createOutboundLeg: (srf: any, number: string, localSdp: string, callerId?: string) => Promise<any | null> },
    destination: string,
    customerNumber: string,
    opts?: { callerId?: string },
  ): Promise<{ ok: boolean; reason?: string }> {
    if (!trunk.isEnabled) return { ok: false, reason: 'trunk_disabled' };
    if (!(await this.ensureConnected())) return { ok: false, reason: 'media_unavailable' };

    let aLeg: Mrf.Endpoint | undefined;
    let bLeg: Mrf.Endpoint | undefined;
    let uacA: any;
    let uacB: any;
    let torndown = false;

    // Tear down both legs + both endpoints exactly once, no matter which ends first.
    const teardown = () => {
      if (torndown) return;
      torndown = true;
      try { uacA?.destroy?.(); } catch { /* noop */ }
      try { uacB?.destroy?.(); } catch { /* noop */ }
      try { aLeg?.destroy?.(); } catch { /* noop */ }
      try { bLeg?.destroy?.(); } catch { /* noop */ }
    };

    const callerId = opts?.callerId;

    try {
      // Leg A — ring the LOCKED destination first and anchor it on FreeSWITCH.
      aLeg = await this.ms!.createEndpoint();
      uacA = await trunk.createOutboundLeg(this.srf, destination, aLeg.local.sdp || '', callerId);
      if (!uacA) { teardown(); return { ok: false, reason: 'destination_unreachable' }; }
      await aLeg.modify(uacA.remote?.sdp || '');
      await this.prepareVoice(aLeg);
      await this.playSafe(aLeg, 'say:Please hold while we connect your call.');

      // Leg B — destination is up; now ring the visitor and anchor that leg too.
      bLeg = await this.ms!.createEndpoint();
      uacB = await trunk.createOutboundLeg(this.srf, customerNumber, bLeg.local.sdp || '', callerId);
      if (!uacB) {
        await this.playSafe(aLeg, 'say:The other party could not be reached. Goodbye.');
        teardown();
        return { ok: false, reason: 'customer_unreachable' };
      }
      await bLeg.modify(uacB.remote?.sdp || '');

      // Any hang-up (either PSTN leg or either FS endpoint) tears the bridge down.
      uacA.on('destroy', teardown);
      uacB.on('destroy', teardown);
      aLeg.on('destroy', teardown);
      bLeg.on('destroy', teardown);

      await aLeg.bridge(bLeg);
      console.log(`✅ Callback: bridged ${destination} ↔ ${customerNumber}`);
      return { ok: true };
    } catch (err: any) {
      console.error('❌ Callback bridge error:', err?.message || err);
      teardown();
      return { ok: false, reason: 'bridge_error' };
    }
  }

  /**
   * Answer a caller and join their leg into a FreeSWITCH conference room.
   *
   * The browser dials `conf-<roomId>`; we anchor the leg on the media server
   * (handles WebRTC DTLS-SRTP) and `join()` it to the named room so every member
   * is mixed together. The room is created on first join by FreeSWITCH itself.
   *
   * `hooks.onJoined` fires once the leg is mixed in; `hooks.onLeft` fires exactly
   * once when the caller hangs up (or the join fails), so the caller can keep the
   * shared roster in step. The INVITE must have been left open for us to answer
   * (no `passFailure` relay), since connectCaller sends the 200 OK here.
   */
  async joinConference(
    req: any,
    res: any,
    roomName: string,
    hooks?: { onJoined?: () => void; onLeft?: () => void },
  ): Promise<boolean> {
    if (!(await this.ensureConnected())) {
      if (!res.finalResponseSent) res.send(480, 'Temporarily Unavailable');
      return false;
    }

    let endpoint: Mrf.Endpoint | undefined;
    let dialog: Srf.Dialog | undefined;
    let torndown = false;
    let leftNotified = false;

    const teardown = () => {
      if (torndown) return;
      torndown = true;
      try { endpoint?.destroy?.(); } catch { /* noop */ }
      try { dialog?.destroy?.(); } catch { /* noop */ }
    };
    const notifyLeft = () => {
      if (leftNotified) return;
      leftNotified = true;
      try { hooks?.onLeft?.(); } catch { /* noop */ }
    };

    try {
      ({ endpoint, dialog } = await this.ms!.connectCaller(req, res));
      await this.prepareVoice(endpoint);
      await this.playSafe(endpoint, 'say:You are joining the conference.');

      // Either the caller hanging up (dialog destroy) or the channel ending
      // (endpoint destroy) means this member left — prune them from the roster.
      dialog.on('destroy', () => { notifyLeft(); teardown(); });
      endpoint.on('destroy', () => { notifyLeft(); });

      await endpoint.join(roomName, { profile: config.conference.profile });
      try { hooks?.onJoined?.(); } catch { /* noop */ }
      console.log(`✅ Conf: ${req.callingNumber || 'caller'} joined ${roomName} (channel=${endpoint.uuid})`);
      return true;
    } catch (err: any) {
      console.error('❌ Conference join error:', err?.message || err);
      notifyLeft();
      teardown();
      if (res && !res.finalResponseSent) res.send(480, 'Temporarily Unavailable');
      return false;
    }
  }

  /**
   * Answer a caller into a call queue and distribute them to an agent (ACD).
   *
   * The browser/PSTN caller dials `queue-<id>`; we anchor their leg on the media
   * server (handles WebRTC DTLS-SRTP), play hold music, then ring the queue's
   * available agents one at a time. The agent to try next is chosen by the
   * caller via `opts.nextAgent()` (the QueueService applies the distribution
   * strategy), so this method stays policy-free — it only does the SIP/media
   * work: ring, wait, and on answer bridge the two legs. The hold music keeps
   * looping until an agent answers (we break it just before bridging).
   *
   * Ringing uses a 3pcc endpoint as the B-leg offer and an outbound UAC to the
   * agent's contact; a per-attempt timer cancels the INVITE if the agent does
   * not answer in `ringTimeoutMs`, and the loop moves on to the next agent. The
   * whole thing gives up after `maxWaitMs`. If the caller hangs up while
   * waiting, the in-flight ring is cancelled and we report `abandoned`.
   *
   * Returns the final outcome plus the agent that answered (if any). The bridged
   * legs live until either side hangs up; teardown + `hooks.onEnded` fire once.
   */
  async enqueueCaller(
    req: any,
    res: any,
    opts: {
      queueName: string;
      moh: string;
      ringTimeoutMs: number;
      maxWaitMs: number;
      pollIntervalMs?: number;
      callerNumber: string;
      callerName: string;
      nextAgent: () => { extension: string; contactUri: string; name: string } | null;
      hooks?: {
        onWaiting?: () => void;
        onRingAgent?: (ext: string) => void;
        onAgentNoAnswer?: (ext: string) => void;
        onConnected?: (ext: string) => void;
        onAbandoned?: () => void;
        onTimeout?: () => void;
        onEnded?: () => void;
      };
    },
  ): Promise<{ outcome: 'connected' | 'abandoned' | 'timeout' | 'failed'; connectedAgent?: string }> {
    if (!(await this.ensureConnected())) {
      if (!res.finalResponseSent) res.send(480, 'Temporarily Unavailable');
      return { outcome: 'failed' };
    }

    const pollIntervalMs = opts.pollIntervalMs ?? 1500;
    const hooks = opts.hooks;

    let aLeg: Mrf.Endpoint | undefined;
    let dialog: Srf.Dialog | undefined;
    let abandoned = false;
    let bridged = false;
    let torndown = false;
    let endedNotified = false;
    /** Cancels the ring currently in flight (set while an agent is being rung). */
    let cancelActiveRing: (() => void) | null = null;

    const teardown = () => {
      if (torndown) return;
      torndown = true;
      try { aLeg?.destroy?.(); } catch { /* noop */ }
      try { dialog?.destroy?.(); } catch { /* noop */ }
    };
    const notifyEnded = () => {
      if (endedNotified) return;
      endedNotified = true;
      try { hooks?.onEnded?.(); } catch { /* noop */ }
    };

    // The caller hung up: stop ringing immediately and let the loop unwind.
    const onCallerGone = () => {
      abandoned = true;
      try { cancelActiveRing?.(); } catch { /* noop */ }
    };

    try {
      ({ endpoint: aLeg, dialog } = await this.ms!.connectCaller(req, res));
      await this.prepareVoice(aLeg);
      await this.playSafe(aLeg, 'say:Please hold while we connect you to an agent.');

      dialog.on('destroy', onCallerGone);
      aLeg.on('destroy', onCallerGone);
      try { hooks?.onWaiting?.(); } catch { /* noop */ }

      // Start hold music (non-blocking; the stream loops until we break it).
      try { aLeg.executeAsync('playback', opts.moh); } catch { /* noop */ }

      const deadline = Date.now() + opts.maxWaitMs;

      while (!abandoned && Date.now() < deadline) {
        const agent = opts.nextAgent();
        if (!agent) {
          // No agent free right now — keep holding and re-check shortly.
          await new Promise((r) => setTimeout(r, pollIntervalMs));
          continue;
        }

        try { hooks?.onRingAgent?.(agent.extension); } catch { /* noop */ }

        // Ring this one agent: a 3pcc endpoint supplies the offer, then we
        // originate an INVITE to the agent's contact and wait for an answer,
        // cancelling if they don't pick up within ringTimeoutMs.
        const bLeg = await this.ms!.createEndpoint();
        const uac = await this.ringAgent(
          agent.contactUri,
          bLeg.local.sdp || '',
          opts.ringTimeoutMs,
          opts.callerNumber,
          opts.callerName,
          opts.queueName,
          (cancel) => { cancelActiveRing = cancel; },
        );
        cancelActiveRing = null;

        if (!uac || abandoned) {
          try { (uac as any)?.destroy?.(); } catch { /* noop */ }
          try { bLeg.destroy(); } catch { /* noop */ }
          if (!uac && !abandoned) {
            try { hooks?.onAgentNoAnswer?.(agent.extension); } catch { /* noop */ }
          }
          continue;
        }

        // Agent answered — point FreeSWITCH at their SDP, stop the hold music
        // and bridge the two legs together.
        try {
          await bLeg.modify((uac as any).remote?.sdp || '');
          try { await aLeg.execute('break'); } catch { /* noop */ }

          const onLegGone = () => {
            try { (uac as any)?.destroy?.(); } catch { /* noop */ }
            try { bLeg.destroy(); } catch { /* noop */ }
            notifyEnded();
            teardown();
          };
          (uac as any).on('destroy', onLegGone);
          bLeg.on('destroy', onLegGone);
          dialog.removeListener('destroy', onCallerGone);
          aLeg.removeListener('destroy', onCallerGone);
          dialog.on('destroy', onLegGone);
          aLeg.on('destroy', onLegGone);

          await aLeg.bridge(bLeg);
          bridged = true;
          try { hooks?.onConnected?.(agent.extension); } catch { /* noop */ }
          console.log(`✅ Queue [${opts.queueName}]: connected ${opts.callerNumber} → agent ${agent.extension}`);
          return { outcome: 'connected', connectedAgent: agent.extension };
        } catch (err: any) {
          console.warn(`⚠️ Queue [${opts.queueName}]: bridge to ${agent.extension} failed: ${err?.message}`);
          try { (uac as any)?.destroy?.(); } catch { /* noop */ }
          try { bLeg.destroy(); } catch { /* noop */ }
          try { hooks?.onAgentNoAnswer?.(agent.extension); } catch { /* noop */ }
          continue;
        }
      }

      // Fell out of the loop without bridging: either the caller left, or we hit
      // the max-wait deadline with no agent ever answering.
      if (abandoned) {
        try { hooks?.onAbandoned?.(); } catch { /* noop */ }
        notifyEnded();
        teardown();
        return { outcome: 'abandoned' };
      }
      try { await this.playSafe(aLeg, 'say:All of our agents are busy. Please try again later. Goodbye.'); } catch { /* noop */ }
      try { hooks?.onTimeout?.(); } catch { /* noop */ }
      notifyEnded();
      teardown();
      return { outcome: 'timeout' };
    } catch (err: any) {
      console.error('❌ Queue enqueue error:', err?.message || err);
      if (!bridged) {
        notifyEnded();
        teardown();
        if (res && !res.finalResponseSent) res.send(480, 'Temporarily Unavailable');
      }
      return { outcome: 'failed' };
    }
  }

  /**
   * Ring a single agent and wait for an answer, cancelling the INVITE if they
   * don't pick up within `ringTimeoutMs`. Resolves to the answered UAC dialog,
   * or null if the agent declined / didn't answer / errored. `onCancel` exposes
   * a canceller so the caller can abort the ring early (e.g. on caller hang-up).
   */
  private ringAgent(
    contactUri: string,
    localSdp: string,
    ringTimeoutMs: number,
    callerNumber: string,
    callerName: string,
    queueName: string,
    onCancel: (cancel: () => void) => void,
  ): Promise<any | null> {
    return new Promise((resolve) => {
      let settled = false;
      let outReq: any;

      const finish = (uac: any | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(uac);
      };
      const cancel = () => {
        if (settled) return;
        try { outReq?.cancel?.(() => { /* noop */ }); } catch { /* noop */ }
        finish(null);
      };

      const timer = setTimeout(cancel, ringTimeoutMs);
      onCancel(cancel);

      this.srf
        .createUAC(
          contactUri,
          {
            localSdp,
            // Present the original caller's number/name on the agent's phone,
            // and tag the INVITE with the queue it came from.
            headers: {
              'From': `"${callerName}" <sip:${callerNumber}@${config.server.domain}>`,
              'X-Queue': queueName,
            },
          },
          { cbRequest: (req: any) => { outReq = req; } },
        )
        .then((uac) => {
          if (settled) {
            // Answered after we already gave up (raced the timeout): drop it.
            try { (uac as any).destroy?.(); } catch { /* noop */ }
            return;
          }
          finish(uac);
        })
        .catch(() => finish(null));
    });
  }

  /**
   * Play a file/prompt, logging it and tolerating a missing file.
   *
   * `endpoint.play()` throws "File Not Found" when FreeSWITCH can't locate the
   * file (e.g. a misconfigured sound path). A single missing prompt must not
   * abort the whole call, so we log which file failed and carry on.
   */
  private async playSafe(endpoint: Mrf.Endpoint, file: string): Promise<void> {
    try {
      await endpoint.play(file);
    } catch (err: any) {
      console.warn(`   ⚠️ play failed for "${file}": ${err?.message}`);
    }
  }

  /**
   * Configure the server-side TTS engine/voice and add a short lead-in silence.
   *
   * Defaults come from env (config.tts — Piper `tts_commandline` /
   * `en_US-amy-medium`). Callers may pass { engine, voice } to override per
   * call; when omitted the env defaults are used. The 500ms silence prevents
   * the first word being clipped while RTP comes up.
   */
  private async prepareVoice(
    endpoint: Mrf.Endpoint,
    opts?: { engine?: string; voice?: string },
  ): Promise<void> {
    try {
      await endpoint.execute('set', `tts_engine=${opts?.engine || config.tts.engine}`);
      await endpoint.execute('set', `tts_voice=${opts?.voice || config.tts.voice}`);
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

    let aborted = false; // set true when the caller hangs up mid-prompt
    for (let attempt = 1; attempt <= tries && !aborted; attempt++) {
      const digit = await new Promise<string>((resolve) => {
        let settled = false;
        let timer: ReturnType<typeof setTimeout> | undefined;

        const finish = (d: string) => {
          if (settled) return;
          settled = true;
          if (timer) clearTimeout(timer);
          endpoint.removeListener('dtmf', onDtmf);
          endpoint.removeListener('destroy', onDestroy);
          resolve(d);
        };

        const onDtmf = (evt: Mrf.DtmfEvent) => {
          console.log(`   ⌨️ ${label}: DTMF received "${evt.dtmf}"`);
          finish(evt.dtmf);
        };
        // Caller hung up while the prompt was playing / awaiting input: resolve
        // immediately instead of waiting out the no-input timeout, and stop the
        // retry loop.
        const onDestroy = () => { aborted = true; finish(''); };
        endpoint.on('dtmf', onDtmf);
        endpoint.once('destroy', onDestroy);

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

      if (aborted) {
        console.log(`   📴 ${label}: caller hung up`);
        break;
      }
      if (digit && (!opts.valid || opts.valid.includes(digit))) {
        console.log(`   ✅ ${label}: accepted "${digit}"`);
        return digit;
      }
      if (digit) console.log(`   ↩️ ${label}: "${digit}" not valid, retrying`);
      else console.log(`   ⏱️ ${label}: no input (${attempt < tries ? 'retrying' : 'giving up'})`);
    }

    return '';
  }

  /**
   * Build the media handlers the flow interpreter needs (wired to this system's
   * private helpers) and execute the flow against the connected caller. Returns
   * how the flow ended so the caller can decide whether to tear the call down.
   */
  private async runFlowForCall(
    endpoint: Mrf.Endpoint,
    flow: IvrFlowGraph,
    state: IVRCallState,
  ): Promise<FlowResult> {
    const ctx: FlowRunnerContext = {
      callId: state.callId,
      callerNumber: state.callerNumber,
      dialedNumber: state.calledNumber,
    };
    const fromName = this.db.getUser(state.callerNumber)?.name || state.callerNumber;
    // Track caller hangup once for the whole flow so the interpreter can bail
    // out between nodes instead of walking the rest of the graph.
    let hungUp = false;
    const onHangup = () => { hungUp = true; };
    endpoint.once('destroy', onHangup);
    const handlers: FlowRunnerHandlers = {
      play: (file) => this.playSafe(endpoint, file),
      collect: (prompt, opts) => this.promptAndCollect(endpoint, prompt, opts),
      voicemail: async (mailbox, opts) => {
        await this.captureVoicemail(endpoint, mailbox, state.callerNumber, fromName, opts);
      },
      transfer: (opts) => this.flowTransfer(endpoint, state, opts),
      sendEmail: (opts) => this.flowSendEmail(state, opts),
      isHungUp: () => hungUp,
    };
    try {
      return await runFlow(flow, ctx, handlers);
    } finally {
      endpoint.removeListener('destroy', onHangup);
    }
  }

  /**
   * IVR flow `email` node (experimental): send an email through a configured
   * `email` connector. Best-effort — a missing/disabled/non-email connector or
   * an SMTP error is logged and swallowed so the call flow continues uninterrupted.
   */
  private async flowSendEmail(
    state: IVRCallState,
    opts: { connectorId: string; to: string; subject: string; body: string },
  ): Promise<void> {
    const id = Number(opts.connectorId);
    if (!Number.isFinite(id) || id <= 0) {
      console.warn(`✉️  IVR email: no connector selected — skipping [${state.callId}]`);
      return;
    }
    const connector = await this.db.getConnector(id);
    if (!connector) {
      console.warn(`✉️  IVR email: connector ${id} not found [${state.callId}]`);
      return;
    }
    if (connector.type !== 'email') {
      console.warn(`✉️  IVR email: connector ${id} is "${connector.type}", not email [${state.callId}]`);
      return;
    }
    if (!connector.enabled) {
      console.warn(`✉️  IVR email: connector "${connector.name}" disabled [${state.callId}]`);
      return;
    }
    try {
      await sendConnectorEmail(connector.config, {
        to: opts.to,
        subject: opts.subject,
        body: opts.body,
      });
      console.log(`✉️  IVR email sent via "${connector.name}" → ${opts.to} [${state.callId}]`);
    } catch (err: any) {
      console.warn(`⚠️ IVR email send failed (connector ${id}): ${err?.message} [${state.callId}]`);
    }
  }

  /**
   * IVR flow `transfer` node: route the caller to a department queue (and/or a
   * named extension) by setting call state and starting hold music, mirroring the
   * built-in menu's behaviour. The agent bridge is driven by the queue/transfer
   * subsystem; this never tears the call down.
   *
   * Before parking the caller it consults the routing orchestrator: a transfer
   * targets a department queue, so an "outside business hours" decision plays the
   * company-closed announcement and ends the call instead. Resolves `true` when
   * the caller was parked for the queue, `false` when the transfer was gated.
   * Backward-compatible: with no business-hours policy the orchestrator reports
   * open and the caller is parked exactly as before.
   */
  private async flowTransfer(
    endpoint: Mrf.Endpoint,
    state: IVRCallState,
    opts: { department?: string; extension?: string; ringSeconds?: number },
  ): Promise<boolean> {
    const dept = opts.department ? this.departments.find((d) => d.id === opts.department) : undefined;
    if (opts.department) {
      state.department = dept?.id || opts.department;
    }

    if (this.routing) {
      try {
        const decision = await this.routing.evaluate({
          callId: state.callId,
          callerNumber: state.callerNumber,
          calledNumber: state.calledNumber,
          targetQueueId: dept?.queueName || opts.department,
          preferQueue: true,
        });
        if (
          decision.type === DecisionType.PlayAnnouncement &&
          decision.reason === UnavailableReason.OutsideCompanyHours
        ) {
          const text = await this.routing.announcement(decision.announcementKey ?? 'company_closed');
          console.log(`⛔ IVR flow transfer: outside business hours → announcement [${state.callId}]`);
          await this.playSafe(endpoint, `say:${text ?? 'Our company is currently closed.'}`);
          this.db.updateCall(state.callId, { status: 'missed' });
          return false;
        }
      } catch (err: any) {
        console.warn(`⚠️ IVR flow transfer routing gate skipped: ${err?.message} [${state.callId}]`);
      }
    }

    state.status = 'queued';
    this.db.updateCall(state.callId, { status: 'answered' });
    const where = opts.department ? `dept:${opts.department}` : opts.extension ? `ext:${opts.extension}` : 'queue';
    console.log(`🔀 IVR flow transfer → ${where} [${state.callId}]`);
    // Hold music loops forever — fire-and-forget so we don't block the flow.
    try { endpoint.executeAsync('playback', config.sounds.holdMusic); } catch { /* noop */ }
    return true;
  }

  async handleIncomingCall(req: any, res: any, existingCallId?: string, dialedNumber?: string): Promise<void> {
    const callId = existingCallId || crypto.randomUUID();
    const callerNumber = req.callingNumber || 'unknown';
    const calledNumber = dialedNumber || req.calledNumber || 'unknown';

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
      console.log(`   ↩️ IVR: FS will dial back to ${config.freeswitch.listenAddress}:${config.freeswitch.listenPort} (X-esl-outbound) [${callId}]`);

      ({ endpoint, dialog } = await this.ms!.connectCaller(req, res));

      console.log(`✅ IVR: media connected, channel=${endpoint.uuid} [${callId}]`);

      // Calmer, clearer TTS voice + brief lead-in silence (see prepareVoice).
      await this.prepareVoice(endpoint);

      // Custom IVR flow? If an enabled flow is published for this DID/extension,
      // run it and skip the built-in menu entirely. Any DID without a flow falls
      // through to the default language/department menu below (no regression).
      const flow = await this.db.getIvrFlow(calledNumber);
      if (flow && flow.enabled && flow.nodes.length) {
        console.log(`🧭 IVR: running custom flow "${flow.name}" (${flow.nodes.length} nodes) [${callId}]`);
        this.db.updateCall(callId, { status: 'answered' });
        const result = await this.runFlowForCall(endpoint, flow, state);
        console.log(`🧭 IVR: flow ended (${result}) [${callId}]`);
        // A `transfer` node leaves the call up on hold music for the queue to
        // pick up; every other outcome (announced / hangup / voicemail /
        // completed / error) is terminal, so tear the answered leg down here.
        // `announced` = routing gated the transfer (e.g. outside business hours)
        // and already played the company-closed prompt, so log it as missed.
        if (result !== 'transferred') {
          this.activeCalls.delete(callId);
          const status = result === 'voicemail' ? 'voicemail' : result === 'announced' ? 'missed' : 'answered';
          this.db.updateCall(callId, { status });
          try { await dialog?.destroy?.(); } catch { /* noop */ }
          try { await endpoint?.destroy?.(); } catch { /* noop */ }
        }
        return;
      }

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
