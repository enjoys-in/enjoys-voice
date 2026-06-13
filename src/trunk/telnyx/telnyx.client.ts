import type {
  CallResult,
  ITrunkClient,
  OriginateCallOptions,
  SendSmsOptions,
  SmsResult,
  TrunkProviderName,
} from "../types";

export interface TelnyxClientConfig {
  apiKey: string;
  /** Call Control / Voice API connection id used to originate calls. */
  connectionId?: string;
}

const TELNYX_API_BASE = "https://api.telnyx.com/v2";

/**
 * Telnyx REST client (fetch-based; no SDK dependency).
 * Docs: https://developers.telnyx.com/api
 * Auth: Bearer API key. Bodies are JSON.
 */
export class TelnyxClient implements ITrunkClient {
  readonly provider: TrunkProviderName = "telnyx";

  constructor(private readonly config: TelnyxClientConfig) {}

  private async post(
    path: string,
    body: Record<string, unknown>
  ): Promise<Record<string, any>> {
    const res = await fetch(`${TELNYX_API_BASE}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, any>;
    if (!res.ok) {
      const msg = data?.errors?.[0]?.detail ?? res.statusText;
      throw new Error(`Telnyx API ${res.status}: ${msg}`);
    }
    return data;
  }

  /** Originate a call via Call Control. Requires a `connectionId`. */
  async originateCall(options: OriginateCallOptions): Promise<CallResult> {
    if (!options.from) throw new Error("Telnyx: originateCall requires `from`");
    if (!this.config.connectionId)
      throw new Error("Telnyx: originateCall requires a `connectionId`");

    const body: Record<string, unknown> = {
      connection_id: this.config.connectionId,
      to: options.to,
      from: options.from,
    };
    if (options.answerUrl) body.webhook_url = options.answerUrl;

    const data = await this.post("/calls", body);
    const payload = data.data ?? data;
    return {
      id: payload.call_control_id ?? payload.call_session_id ?? "",
      status: payload.status ?? "initiated",
      raw: data,
    };
  }

  async sendSms(options: SendSmsOptions): Promise<SmsResult> {
    if (!options.from) throw new Error("Telnyx: sendSms requires `from`");
    const data = await this.post("/messages", {
      from: options.from,
      to: options.to,
      text: options.text,
    });
    const payload = data.data ?? data;
    return {
      id: payload.id ?? "",
      status: payload.to?.[0]?.status ?? "queued",
      raw: data,
    };
  }
}
