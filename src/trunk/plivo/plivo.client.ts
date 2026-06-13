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

export interface PlivoClientConfig {
  authId: string;
  authToken: string;
}

const PLIVO_API_BASE = "https://api.plivo.com/v1/Account";

/** Escape a value for safe inclusion in Plivo XML text/attributes. */
function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Plivo uses inbound/outbound/both literally; bidirectional forces inbound. */
function plivoTrack(options: MediaStreamOptions): string {
  if (options.bidirectional) return "inbound";
  return options.track ?? "inbound";
}

/**
 * Plivo REST client (fetch-based; no SDK dependency).
 * Docs: https://www.plivo.com/docs/voice/api/call
 * Auth: HTTP Basic (AuthId:AuthToken). Bodies are JSON.
 */
export class PlivoClient implements ITrunkClient {
  readonly provider: TrunkProviderName = "plivo";

  constructor(private readonly config: PlivoClientConfig) {}

  private get authHeader(): string {
    const token = Buffer.from(
      `${this.config.authId}:${this.config.authToken}`
    ).toString("base64");
    return `Basic ${token}`;
  }

  private async post(
    path: string,
    body: Record<string, unknown>
  ): Promise<Record<string, any>> {
    const res = await fetch(`${PLIVO_API_BASE}/${this.config.authId}${path}`, {
      method: "POST",
      headers: {
        Authorization: this.authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, any>;
    if (!res.ok) {
      throw new Error(`Plivo API ${res.status}: ${data?.error ?? res.statusText}`);
    }
    return data;
  }

  /** Originate a call. Requires `answerUrl` (returns Plivo XML). */
  async originateCall(options: OriginateCallOptions): Promise<CallResult> {
    if (!options.from) throw new Error("Plivo: originateCall requires `from`");
    if (!options.answerUrl)
      throw new Error("Plivo: originateCall requires an `answerUrl`");

    const data = await this.post("/Call/", {
      from: options.from,
      to: options.to,
      answer_url: options.answerUrl,
      answer_method: "POST",
    });
    return {
      id: data.request_uuid ?? data.api_id ?? "",
      status: data.message ?? "queued",
      raw: data,
    };
  }

  async sendSms(options: SendSmsOptions): Promise<SmsResult> {
    if (!options.from) throw new Error("Plivo: sendSms requires `from`");
    const data = await this.post("/Message/", {
      src: options.from,
      dst: options.to,
      text: options.text,
    });
    return {
      id: data.message_uuid?.[0] ?? data.api_id ?? "",
      status: data.message ?? "queued",
      raw: data,
    };
  }

  /**
   * Start audio streaming on an active call via the Plivo Audio Streams API.
   * Docs: https://www.plivo.com/docs/voice-agents/audio-streaming/api/audio-streams
   * `keepCallAlive` is forced true so the call isn't dropped when the stream ends.
   * Param names follow the Audio Streams API (mirrors the `<Stream>` element).
   */
  async startMediaStream(
    callId: string,
    options: MediaStreamOptions
  ): Promise<StreamResult> {
    const body: Record<string, unknown> = {
      service_url: options.wsUrl,
      bidirectional: options.bidirectional ?? false,
      audio_track: plivoTrack(options),
      keep_call_alive: true,
    };
    if (options.contentType) body.content_type = options.contentType;
    const extra = Object.entries(options.parameters ?? {})
      .map(([k, v]) => `${k}=${v}`)
      .join(",");
    if (extra) body.extra_headers = extra;

    const data = await this.post(`/Call/${callId}/Stream/`, body);
    return {
      id: data.stream_id ?? data.api_id ?? "",
      status: data.message ?? "streaming",
      raw: data,
    };
  }

  /**
   * Build a Plivo XML document that starts an audio stream. Serve this from the
   * `answerUrl` to stream from the start of the call. `bidirectional` lets your
   * socket play audio back (audioTrack is forced to inbound, per Plivo).
   */
  buildStreamInstruction(options: MediaStreamOptions): string {
    const attrs: string[] = [
      `bidirectional="${options.bidirectional ? "true" : "false"}"`,
      `audioTrack="${plivoTrack(options)}"`,
      `keepCallAlive="true"`,
    ];
    if (options.contentType)
      attrs.push(`contentType="${xmlEscape(options.contentType)}"`);
    const extra = Object.entries(options.parameters ?? {})
      .map(([k, v]) => `${k}=${v}`)
      .join(",");
    if (extra) attrs.push(`extraHeaders="${xmlEscape(extra)}"`);

    return `<?xml version="1.0" encoding="UTF-8"?><Response><Stream ${attrs.join(
      " "
    )}>${xmlEscape(options.wsUrl)}</Stream></Response>`;
  }
}
