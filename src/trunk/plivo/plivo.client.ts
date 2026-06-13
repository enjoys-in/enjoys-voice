import type {
  CallResult,
  ITrunkClient,
  OriginateCallOptions,
  SendSmsOptions,
  SmsResult,
  TrunkProviderName,
} from "../types";

export interface PlivoClientConfig {
  authId: string;
  authToken: string;
}

const PLIVO_API_BASE = "https://api.plivo.com/v1/Account";

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
}
