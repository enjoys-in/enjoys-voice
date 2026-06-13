import { BaseTrunkProvider } from "../base.trunk";
import { trunkConfig } from "../config";
import type { SipTrunkConfig, TrunkProviderName } from "../types";
import { PlivoClient } from "./plivo.client";

export interface PlivoTrunkConfig {
  authId: string;
  authToken: string;
  /** SIP termination host (Zentrunk). Default `sip.plivo.com`. */
  sipHost?: string;
  transport?: "udp" | "tcp" | "tls";
  port?: number;
  /** Credential-auth SIP trunk username/password (optional). */
  sipUsername?: string;
  sipPassword?: string;
  callerId?: string;
  enabled?: boolean;
}

/**
 * Plivo trunk provider. Outbound PSTN via Zentrunk SIP termination
 * (`sip.plivo.com`) plus a REST client for voice + messaging.
 * Docs: https://www.plivo.com/docs/zentrunk
 */
export class PlivoTrunkService extends BaseTrunkProvider {
  readonly name: TrunkProviderName = "plivo";
  readonly client: PlivoClient;

  constructor(config: PlivoTrunkConfig) {
    const sip: SipTrunkConfig = {
      host: config.sipHost ?? "sip.plivo.com",
      port: config.port ?? 5060,
      transport: config.transport ?? "udp",
      username: config.sipUsername,
      password: config.sipPassword,
      callerId: config.callerId,
    };
    super(sip, config.enabled ?? true);
    this.client = new PlivoClient({
      authId: config.authId,
      authToken: config.authToken,
    });
  }

  /** Build a PlivoTrunkService from environment variables (see src/trunk/config.ts). */
  static fromEnv(): PlivoTrunkService {
    return new PlivoTrunkService(trunkConfig.plivo);
  }
}
