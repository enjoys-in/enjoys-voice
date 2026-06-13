import type {
  CallResult,
  ITrunkClient,
  MediaStreamOptions,
  MediaStreamTrack,
  OriginateCallOptions,
  SendSmsOptions,
  SmsResult,
  StreamResult,
  TrunkProviderName,
} from "../types";

export interface TwilioClientConfig {
  accountSid: string;
  authToken: string;
}

const TWILIO_API_BASE = "https://api.twilio.com/2010-04-01";

/** Map a generic track to Twilio's `<Stream track>` / Streams API value. */
function twilioTrack(track: MediaStreamTrack | undefined): string {
  if (track === "outbound") return "outbound_track";
  if (track === "both") return "both_tracks";
  return "inbound_track";
}

/** Escape a value for safe inclusion in a TwiML attribute. */
function xmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Twilio REST client (fetch-based; no SDK dependency).
 * Docs: https://www.twilio.com/docs/voice/api/call-resource
 * Auth: HTTP Basic (AccountSid:AuthToken). Bodies are form-urlencoded.
 */
export class TwilioClient implements ITrunkClient {
  readonly provider: TrunkProviderName = "twilio";

  constructor(private readonly config: TwilioClientConfig) {}

  private get authHeader(): string {
    const token = Buffer.from(
      `${this.config.accountSid}:${this.config.authToken}`
    ).toString("base64");
    return `Basic ${token}`;
  }

  private async post(
    path: string,
    form: Record<string, string>
  ): Promise<Record<string, any>> {
    const res = await fetch(`${TWILIO_API_BASE}${path}`, {
      method: "POST",
      headers: {
        Authorization: this.authHeader,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(form).toString(),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, any>;
    if (!res.ok) {
      throw new Error(`Twilio API ${res.status}: ${data?.message ?? res.statusText}`);
    }
    return data;
  }

  /** Originate a call. Requires `answerUrl` (TwiML URL) or a twiml `instructions` string. */
  async originateCall(options: OriginateCallOptions): Promise<CallResult> {
    if (!options.from) throw new Error("Twilio: originateCall requires `from`");
    const form: Record<string, string> = { To: options.to, From: options.from };
    if (options.answerUrl) form.Url = options.answerUrl;
    else if (typeof options.instructions === "string") form.Twiml = options.instructions;
    else throw new Error("Twilio: originateCall requires `answerUrl` or twiml `instructions`");

    const data = await this.post(
      `/Accounts/${this.config.accountSid}/Calls.json`,
      form
    );
    return { id: data.sid, status: data.status, raw: data };
  }

  async sendSms(options: SendSmsOptions): Promise<SmsResult> {
    if (!options.from) throw new Error("Twilio: sendSms requires `from`");
    const data = await this.post(
      `/Accounts/${this.config.accountSid}/Messages.json`,
      { To: options.to, From: options.from, Body: options.text }
    );
    return { id: data.sid, status: data.status, raw: data };
  }

  /**
   * Start a Media Stream on an active call via the Streams subresource.
   * Docs: https://www.twilio.com/docs/voice/api/stream-resource
   * Note: REST-created streams are UNIDIRECTIONAL (audio is forked to your
   * socket only). For two-way audio use `buildStreamInstruction` with a
   * `<Connect><Stream>` TwiML instead.
   */
  async startMediaStream(
    callId: string,
    options: MediaStreamOptions
  ): Promise<StreamResult> {
    if (options.bidirectional) {
      throw new Error(
        "Twilio: bidirectional streaming requires <Connect><Stream> TwiML — use buildStreamInstruction()"
      );
    }
    const form: Record<string, string> = {
      Url: options.wsUrl,
      Track: twilioTrack(options.track),
    };
    if (options.name) form.Name = options.name;
    let i = 1;
    for (const [key, value] of Object.entries(options.parameters ?? {})) {
      form[`Parameter${i}.name`] = key;
      form[`Parameter${i}.value`] = value;
      i++;
    }
    const data = await this.post(
      `/Accounts/${this.config.accountSid}/Calls/${callId}/Streams.json`,
      form
    );
    return { id: data.sid, status: data.status, raw: data };
  }

  /**
   * Build a TwiML document that starts a Media Stream. `bidirectional` uses
   * `<Connect><Stream>` (two-way audio, blocks until the socket closes);
   * otherwise `<Start><Stream>` forks audio and continues the call.
   */
  buildStreamInstruction(options: MediaStreamOptions): string {
    const params = Object.entries(options.parameters ?? {})
      .map(
        ([k, v]) =>
          `<Parameter name="${xmlAttr(k)}" value="${xmlAttr(v)}"/>`
      )
      .join("");
    const name = options.name ? ` name="${xmlAttr(options.name)}"` : "";
    if (options.bidirectional) {
      return `<?xml version="1.0" encoding="UTF-8"?><Response><Connect><Stream url="${xmlAttr(
        options.wsUrl
      )}"${name}>${params}</Stream></Connect></Response>`;
    }
    return `<?xml version="1.0" encoding="UTF-8"?><Response><Start><Stream url="${xmlAttr(
      options.wsUrl
    )}" track="${twilioTrack(options.track)}"${name}>${params}</Stream></Start></Response>`;
  }
}
