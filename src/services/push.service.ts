import { config } from '@/core';

/** A single registered device push token. */
interface DeviceToken {
  token: string;
  platform: string; // 'android' | 'ios' | 'ios_voip'
  registeredAt: number;
}

/** Payload the Flutter app expects in an `incoming_call` data message. */
export interface IncomingCallPush {
  callId: string;
  from: string;
  fromName: string;
  to: string;
}

/** Payload for a `missed_call` notification (not a ring — a normal push). */
export interface MissedCallPush {
  callId: string;
  from: string;
  fromName: string;
  timestamp: string;
}

/** Payload for a `new_voicemail` notification. */
export interface NewVoicemailPush {
  voicemailId: string;
  from: string;
  fromName: string;
  duration: number;
  transcript?: string;
}

const FCM_ENDPOINT = 'https://fcm.googleapis.com/fcm/send';

/**
 * Mobile push wake-up for the Flutter softphone.
 *
 * Stores device tokens per extension (in memory) and, on an inbound call, sends
 * a high-priority FCM data message that wakes a backgrounded Android device and
 * raises the native CallKit incoming-call UI. iOS background calls require an
 * APNs VoIP (PushKit) push — those tokens are stored under the `ios_voip`
 * platform for a future APNs sender (see mobile/README.md).
 *
 * Entirely inert unless `PUSH_ENABLED=true`.
 */
export class PushService {
  /** extension → token string → record */
  private readonly byExtension = new Map<string, Map<string, DeviceToken>>();

  get enabled(): boolean {
    return config.push.enabled;
  }

  /** Register (or refresh) a device token for an extension. */
  register(extension: string, token: string, platform: string): void {
    if (!extension || !token) return;
    let tokens = this.byExtension.get(extension);
    if (!tokens) {
      tokens = new Map();
      this.byExtension.set(extension, tokens);
    }
    tokens.set(token, { token, platform, registeredAt: Date.now() });
  }

  /** Remove a token from whichever extension owns it (logout / token rotation). */
  unregister(token: string): void {
    if (!token) return;
    for (const [ext, tokens] of this.byExtension) {
      if (tokens.delete(token) && tokens.size === 0) {
        this.byExtension.delete(ext);
      }
    }
  }

  hasTokens(extension: string): boolean {
    const t = this.byExtension.get(extension);
    return !!t && t.size > 0;
  }

  /**
   * Fire an incoming-call push to every device registered for [extension].
   * Best-effort and fully guarded: never throws into the SIP path.
   */
  async sendIncomingCall(extension: string, payload: IncomingCallPush): Promise<void> {
    if (!this.enabled) return;
    const tokens = this.byExtension.get(extension);
    if (!tokens || tokens.size === 0) return;

    const fcmTokens: string[] = [];
    for (const rec of tokens.values()) {
      // iOS VoIP tokens are delivered via APNs/PushKit, not FCM legacy.
      if (rec.platform === 'ios_voip') continue;
      fcmTokens.push(rec.token);
    }

    if (fcmTokens.length > 0) {
      await this.sendFcm(fcmTokens, payload).catch((err) => {
        console.warn('⚠️  Push: FCM send failed:', (err as Error).message);
      });
    }
  }

  /**
   * Fire a missed-call notification (normal priority — not a full-screen ring).
   * Best-effort; never throws. Callers gate this on the user's
   * `notifyMissedPush` preference before invoking.
   */
  async sendMissedCall(extension: string, payload: MissedCallPush): Promise<void> {
    await this.sendData(extension, {
      type: 'missed_call',
      callId: payload.callId,
      from: payload.from,
      fromName: payload.fromName,
      timestamp: payload.timestamp,
    });
  }

  /**
   * Fire a new-voicemail notification. Best-effort; never throws. Callers gate
   * this on the user's `notifyVoicemailPush` preference before invoking.
   */
  async sendNewVoicemail(extension: string, payload: NewVoicemailPush): Promise<void> {
    await this.sendData(extension, {
      type: 'new_voicemail',
      voicemailId: payload.voicemailId,
      from: payload.from,
      fromName: payload.fromName,
      duration: String(payload.duration),
      ...(payload.transcript ? { transcript: payload.transcript } : {}),
    });
  }

  /**
   * Send a normal-priority FCM data message to every non-VoIP device registered
   * for [extension]. Shared by the missed-call and voicemail notifications;
   * fully guarded so a push failure never propagates into the call path.
   */
  private async sendData(extension: string, data: Record<string, string>): Promise<void> {
    if (!this.enabled) return;
    const tokens = this.byExtension.get(extension);
    if (!tokens || tokens.size === 0) return;
    if (!config.push.fcmServerKey) return;

    const fcmTokens: string[] = [];
    for (const rec of tokens.values()) {
      if (rec.platform === 'ios_voip') continue;
      fcmTokens.push(rec.token);
    }
    if (fcmTokens.length === 0) return;

    try {
      const res = await fetch(FCM_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `key=${config.push.fcmServerKey}`,
        },
        body: JSON.stringify({ registration_ids: fcmTokens, priority: 'normal', data }),
      });
      if (!res.ok) throw new Error(`FCM HTTP ${res.status}`);
    } catch (err) {
      console.warn(`⚠️  Push: ${data.type} send failed:`, (err as Error).message);
    }
  }

  private async sendFcm(registrationIds: string[], payload: IncomingCallPush): Promise<void> {
    if (!config.push.fcmServerKey) {
      console.warn('⚠️  Push: PUSH_ENABLED but FCM_SERVER_KEY is empty — skipping FCM send');
      return;
    }
    const body = {
      registration_ids: registrationIds,
      priority: 'high',
      content_available: true,
      data: {
        type: 'incoming_call',
        callId: payload.callId,
        from: payload.from,
        fromName: payload.fromName,
        to: payload.to,
      },
    };
    const res = await fetch(FCM_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `key=${config.push.fcmServerKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`FCM HTTP ${res.status}`);
    }
  }
}
