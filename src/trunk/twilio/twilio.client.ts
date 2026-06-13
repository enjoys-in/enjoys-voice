import type {
  CallResult,
  ITrunkClient,
  OriginateCallOptions,
  SendSmsOptions,
  SmsResult,
  TrunkProviderName,
} from "../types";

export interface TwilioClientConfig {
  accountSid: string;
  authToken: string;
}

const TWILIO_API_BASE = "https://api.twilio.com/2010-04-01";

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
}
