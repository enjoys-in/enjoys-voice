import { BaseTrunkProvider } from "../base.trunk";
import { trunkConfig } from "../config";
import type { SipTrunkConfig, TrunkProviderName } from "../types";
import { VonageClient } from "./vonage.client";

export interface VonageTrunkConfig {
  /** Voice API credentials (RS256 JWT). */
  applicationId?: string;
  privateKey?: string;
  /** SMS API credentials. */
  apiKey?: string;
  apiSecret?: string;
  /** SIP termination host. Default `sip.nexmo.com`. */
  sipHost?: string;
  transport?: "udp" | "tcp" | "tls";
  port?: number;
  callerId?: string;
  enabled?: boolean;
}

/**
 * Vonage (Nexmo) trunk provider. Outbound PSTN via SIP termination
 * (`sip.nexmo.com`) plus a REST client for Voice (NCCO) + SMS.
 * Docs: https://developer.vonage.com/en/voice/sip/concepts/programmable-sip
 */
export class VonageTrunkService extends BaseTrunkProvider {
  readonly name: TrunkProviderName = "vonage";
  readonly client: VonageClient;

  constructor(config: VonageTrunkConfig) {
    const sip: SipTrunkConfig = {
      host: config.sipHost ?? "sip.nexmo.com",
      port: config.port ?? 5060,
      transport: config.transport ?? "udp",
      callerId: config.callerId,
    };
    super(sip, config.enabled ?? true);
    this.client = new VonageClient({
      applicationId: config.applicationId,
      privateKey: config.privateKey,
      apiKey: config.apiKey,
      apiSecret: config.apiSecret,
    });
  }

  /** Build a VonageTrunkService from environment variables (see src/trunk/config.ts). */
  static fromEnv(): VonageTrunkService {
    return new VonageTrunkService(trunkConfig.vonage);
  }
}
