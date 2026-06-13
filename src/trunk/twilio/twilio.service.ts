import { BaseTrunkProvider } from "../base.trunk";
import { trunkConfig } from "../config";
import type { SipTrunkConfig, TrunkProviderName } from "../types";
import { TwilioClient } from "./twilio.client";

export interface TwilioTrunkConfig {
  accountSid: string;
  authToken: string;
  /** Elastic SIP Trunking termination domain, e.g. `my-trunk.pstn.twilio.com`. */
  sipDomain: string;
  /** SIP transport. Twilio recommends TLS:5061 (secure trunking). Default udp:5060. */
  transport?: "udp" | "tcp" | "tls";
  port?: number;
  /** E.164 caller ID (a verified/purchased Twilio number). */
  callerId?: string;
  enabled?: boolean;
}

/**
 * Twilio trunk provider. Outbound PSTN via Elastic SIP Trunking
 * (`<domain>.pstn.twilio.com`) plus a REST client for programmable voice/SMS.
 * Docs: https://www.twilio.com/docs/sip-trunking
 */
export class TwilioTrunkService extends BaseTrunkProvider {
  readonly name: TrunkProviderName = "twilio";
  readonly client: TwilioClient;

  constructor(config: TwilioTrunkConfig) {
    const sip: SipTrunkConfig = {
      host: config.sipDomain,
      port: config.port ?? 5060,
      transport: config.transport ?? "udp",
      callerId: config.callerId,
    };
    super(sip, config.enabled ?? true);
    this.client = new TwilioClient({
      accountSid: config.accountSid,
      authToken: config.authToken,
    });
  }

  /** Build a TwilioTrunkService from environment variables (see src/trunk/config.ts). */
  static fromEnv(): TwilioTrunkService {
    return new TwilioTrunkService(trunkConfig.twilio);
  }
}
