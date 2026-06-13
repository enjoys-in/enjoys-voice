import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import type {
  CallResult,
  ITrunkClient,
  MediaStreamOptions,
  OriginateCallOptions,
  SendSmsOptions,
  SmsResult,
  StreamResult,
  TrunkProviderName,
} from "../types";

export interface VonageClientConfig {
  /** Voice API: application id + private key (RS256 JWT auth). */
  applicationId?: string;
  privateKey?: string;
  /** SMS API: account key/secret (form auth). */
  apiKey?: string;
  apiSecret?: string;
}

const VONAGE_VOICE_BASE = "https://api.nexmo.com/v1/calls";
const VONAGE_SMS_BASE = "https://rest.nexmo.com/sms/json";

/**
 * Vonage (Nexmo) REST client (fetch-based; no SDK dependency).
 * Docs: https://developer.vonage.com/en/voice/voice-api/overview
 * Voice API: short-lived RS256 JWT (jsonwebtoken). SMS API: api_key/api_secret.
 */
export class VonageClient implements ITrunkClient {
  readonly provider: TrunkProviderName = "vonage";

  constructor(private readonly config: VonageClientConfig) {}

  /** Generate a short-lived RS256 JWT for the Voice API. */
  private generateVoiceJwt(): string {
    if (!this.config.applicationId || !this.config.privateKey) {
      throw new Error("Vonage: Voice API requires `applicationId` and `privateKey`");
    }
    const now = Math.floor(Date.now() / 1000);
    return jwt.sign(
      {
        application_id: this.config.applicationId,
        iat: now,
        exp: now + 60,
        jti: randomUUID(),
      },
      this.config.privateKey,
      { algorithm: "RS256" }
    );
  }

  /** Originate a call. Requires an `answerUrl` (returns NCCO) or NCCO `instructions`. */
  async originateCall(options: OriginateCallOptions): Promise<CallResult> {
    if (!options.from) throw new Error("Vonage: originateCall requires `from`");

    const body: Record<string, unknown> = {
      to: [{ type: "phone", number: options.to.replace(/^\+/, "") }],
      from: { type: "phone", number: options.from.replace(/^\+/, "") },
    };
    if (options.answerUrl) body.answer_url = [options.answerUrl];
    else if (Array.isArray(options.instructions)) body.ncco = options.instructions;
    else throw new Error("Vonage: originateCall requires `answerUrl` or NCCO `instructions`");

    const res = await fetch(VONAGE_VOICE_BASE, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.generateVoiceJwt()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, any>;
    if (!res.ok) {
      throw new Error(`Vonage Voice API ${res.status}: ${data?.title ?? res.statusText}`);
    }
    return { id: data.uuid ?? "", status: data.status ?? "started", raw: data };
  }

  async sendSms(options: SendSmsOptions): Promise<SmsResult> {
    if (!this.config.apiKey || !this.config.apiSecret) {
      throw new Error("Vonage: sendSms requires `apiKey` and `apiSecret`");
    }
    if (!options.from) throw new Error("Vonage: sendSms requires `from`");

    const form = new URLSearchParams({
      api_key: this.config.apiKey,
      api_secret: this.config.apiSecret,
      from: options.from,
      to: options.to.replace(/^\+/, ""),
      text: options.text,
    });
    const res = await fetch(VONAGE_SMS_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, any>;
    const msg = data?.messages?.[0] ?? {};
    if (!res.ok || msg.status !== "0") {
      throw new Error(`Vonage SMS API: ${msg["error-text"] ?? res.statusText}`);
    }
    return { id: msg["message-id"] ?? "", status: "sent", raw: data };
  }

  /**
   * Start audio streaming on an active call by transferring it to a `connect`
   * NCCO with a WebSocket endpoint. Vonage WebSocket media is always
   * full-duplex, so `track`/`bidirectional` are ignored.
   * Docs: https://developer.vonage.com/en/voice/voice-api/ncco-reference#connect
   */
  async startMediaStream(
    callId: string,
    options: MediaStreamOptions
  ): Promise<StreamResult> {
    const res = await fetch(`${VONAGE_VOICE_BASE}/${callId}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${this.generateVoiceJwt()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "transfer",
        destination: { type: "ncco", ncco: this.buildStreamInstruction(options) },
      }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as Record<string, any>;
      throw new Error(
        `Vonage Voice API ${res.status}: ${data?.title ?? res.statusText}`
      );
    }
    return { id: callId, status: "transferred", raw: { uuid: callId } };
  }

  /**
   * Build a `connect` NCCO with a WebSocket endpoint. Serve from the answer_url
   * or pass as originate `instructions` to stream from the start of the call.
   * Audio is 16-bit signed little-endian PCM (L16); two-way by nature.
   */
  buildStreamInstruction(options: MediaStreamOptions): Record<string, unknown>[] {
    const endpoint: Record<string, unknown> = {
      type: "websocket",
      uri: options.wsUrl,
      "content-type": options.contentType ?? "audio/l16;rate=16000",
    };
    if (options.parameters) endpoint.headers = options.parameters;
    return [{ action: "connect", endpoint: [endpoint] }];
  }
}
