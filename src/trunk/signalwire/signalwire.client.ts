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

export interface SignalwireClientConfig {
  /** SignalWire Project ID (used as the "account" in the compatibility API). */
  projectId: string;
  /** SignalWire API Token (used as the password for HTTP Basic auth). */
  apiToken: string;
  /** SignalWire Space URL, e.g. `example.signalwire.com` (no scheme). */
  spaceUrl: string;
}

/** Map a generic track to SignalWire's `<Stream track>` value (LaML = TwiML). */
function swTrack(track: MediaStreamTrack | undefined): string {
  if (track === "outbound") return "outbound_track";
  if (track === "both") return "both_tracks";
  return "inbound_track";
}

/** Escape a value for safe inclusion in a LaML/XML attribute. */
function xmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * SignalWire REST client (fetch-based; no SDK dependency).
 *
 * SignalWire exposes a Twilio-compatible "LaML" REST API at:
 *   https://<space>.signalwire.com/api/laml/2010-04-01
 *
 * Auth: HTTP Basic (ProjectId:ApiToken). Bodies are form-urlencoded.
 * Docs: https://developer.signalwire.com/rest/compatibility-api/endpoints/calls
 */
export class SignalwireClient implements ITrunkClient {
  readonly provider: TrunkProviderName = "signalwire";

  constructor(private readonly config: SignalwireClientConfig) {}

  /** The LaML compatibility API base URL for this space. */
  private get apiBase(): string {
    return `https://${this.config.spaceUrl}/api/laml/2010-04-01`;
  }

  private get authHeader(): string {
    const token = Buffer.from(
      `${this.config.projectId}:${this.config.apiToken}`
    ).toString("base64");
    return `Basic ${token}`;
  }

  private async post(
    path: string,
    form: Record<string, string>
  ): Promise<Record<string, any>> {
    const res = await fetch(`${this.apiBase}${path}`, {
      method: "POST",
      headers: {
        Authorization: this.authHeader,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(form).toString(),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, any>;
    if (!res.ok) {
      throw new Error(`SignalWire API ${res.status}: ${data?.message ?? res.statusText}`);
    }
    return data;
  }

  /** Originate a call. Requires `answerUrl` (LaML URL) or a LaML `instructions` string. */
  async originateCall(options: OriginateCallOptions): Promise<CallResult> {
    if (!options.from) throw new Error("SignalWire: originateCall requires `from`");
    const form: Record<string, string> = { To: options.to, From: options.from };
    if (options.answerUrl) form.Url = options.answerUrl;
    else if (typeof options.instructions === "string") form.Twiml = options.instructions;
    else throw new Error("SignalWire: originateCall requires `answerUrl` or LaML `instructions`");

    const data = await this.post(
      `/Accounts/${this.config.projectId}/Calls.json`,
      form
    );
    return { id: data.sid, status: data.status, raw: data };
  }

  async sendSms(options: SendSmsOptions): Promise<SmsResult> {
    if (!options.from) throw new Error("SignalWire: sendSms requires `from`");
    const data = await this.post(
      `/Accounts/${this.config.projectId}/Messages.json`,
      { To: options.to, From: options.from, Body: options.text }
    );
    return { id: data.sid, status: data.status, raw: data };
  }

  /**
   * Start a Media Stream on an active call via the Streams subresource.
   *
   * NOTE: REST-created streams are UNIDIRECTIONAL (audio is forked to your
   * socket only). For two-way audio use `buildStreamInstruction` with a
   * `<Connect><Stream>` LaML instead.
   */
  async startMediaStream(
    callId: string,
    options: MediaStreamOptions
  ): Promise<StreamResult> {
    if (options.bidirectional) {
      throw new Error(
        "SignalWire: bidirectional streaming requires <Connect><Stream> LaML — use buildStreamInstruction()"
      );
    }
    const form: Record<string, string> = {
      Url: options.wsUrl,
      Track: swTrack(options.track),
    };
    if (options.name) form.Name = options.name;
    let i = 1;
    for (const [key, value] of Object.entries(options.parameters ?? {})) {
      form[`Parameter${i}.name`] = key;
      form[`Parameter${i}.value`] = value;
      i++;
    }
    const data = await this.post(
      `/Accounts/${this.config.projectId}/Calls/${callId}/Streams.json`,
      form
    );
    return { id: data.sid, status: data.status, raw: data };
  }

  /**
   * Build a LaML document that starts a Media Stream. `bidirectional` uses
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
    )}" track="${swTrack(options.track)}"${name}>${params}</Stream></Start></Response>`;
  }
}
