import type {
  CallResult,
  ITrunkClient,
  ITrunkProvider,
  MediaStreamOptions,
  OriginateCallOptions,
  SendSmsOptions,
  SipTrunkConfig,
  SmsResult,
  StreamResult,
  TrunkProviderName,
} from "./types";

/**
 * Shared base for trunk providers. Holds the SIP termination config + REST
 * client and implements the common E.164 normalization / SIP URI formatting,
 * so each provider only supplies its host, credentials and client.
 */
export abstract class BaseTrunkProvider implements ITrunkProvider {
  abstract readonly name: TrunkProviderName;
  abstract readonly client: ITrunkClient;

  protected readonly sip: SipTrunkConfig;
  protected readonly enabled: boolean;

  constructor(sip: SipTrunkConfig, enabled: boolean) {
    this.sip = sip;
    this.enabled = enabled;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  getSipConfig(): SipTrunkConfig {
    return this.sip;
  }

  /**
   * Normalize a dialed number to E.164. A bare 10-digit number is assumed
   * Indian (+91) when it starts 6–9, otherwise North American (+1).
   */
  protected normalizeE164(number: string): string {
    const clean = number.replace(/[^+\d]/g, "");
    if (clean.startsWith("+")) return clean;
    if (clean.length === 10 && /^[6-9]/.test(clean)) return "+91" + clean;
    if (clean.length === 10) return "+1" + clean;
    return "+" + clean;
  }

  formatOutboundUri(number: string): string {
    const e164 = this.normalizeE164(number);
    const prefix = this.sip.prefix ?? "";
    return `sip:${prefix}${e164}@${this.sip.host}:${this.sip.port};transport=${this.sip.transport}`;
  }

  originateCall(options: OriginateCallOptions): Promise<CallResult> {
    return this.client.originateCall({
      ...options,
      from: options.from ?? this.sip.callerId,
    });
  }

  sendSms(options: SendSmsOptions): Promise<SmsResult> {
    return this.client.sendSms({
      ...options,
      from: options.from ?? this.sip.callerId,
    });
  }

  startMediaStream(
    callId: string,
    options: MediaStreamOptions,
  ): Promise<StreamResult> {
    return this.client.startMediaStream(callId, options);
  }

  buildStreamInstruction(options: MediaStreamOptions): unknown {
    return this.client.buildStreamInstruction(options);
  }
}
