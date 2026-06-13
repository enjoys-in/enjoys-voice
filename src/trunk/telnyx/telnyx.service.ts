import { BaseTrunkProvider } from "../base.trunk";
import { trunkConfig } from "../config";
import type { SipTrunkConfig, TrunkProviderName } from "../types";
import { TelnyxClient } from "./telnyx.client";

export interface TelnyxTrunkConfig {
  apiKey: string;
  /** Call Control connection id used to originate calls. */
  connectionId?: string;
  /** SIP termination host. Default `sip.telnyx.com`. */
  sipHost?: string;
  transport?: "udp" | "tcp" | "tls";
  port?: number;
  /** Credential-auth SIP connection username/password (optional). */
  sipUsername?: string;
  sipPassword?: string;
  callerId?: string;
  enabled?: boolean;
}

/**
 * Telnyx trunk provider. Outbound PSTN via SIP termination (`sip.telnyx.com`)
 * plus a REST client for Call Control voice + messaging.
 * Docs: https://developers.telnyx.com/docs/voice/sip-trunking
 */
export class TelnyxTrunkService extends BaseTrunkProvider {
  readonly name: TrunkProviderName = "telnyx";
  readonly client: TelnyxClient;

  constructor(config: TelnyxTrunkConfig) {
    const sip: SipTrunkConfig = {
      host: config.sipHost ?? "sip.telnyx.com",
      port: config.port ?? 5060,
      transport: config.transport ?? "udp",
      username: config.sipUsername,
      password: config.sipPassword,
      callerId: config.callerId,
    };
    super(sip, config.enabled ?? true);
    this.client = new TelnyxClient({
      apiKey: config.apiKey,
      connectionId: config.connectionId,
    });
  }

  /** Build a TelnyxTrunkService from environment variables (see src/trunk/config.ts). */
  static fromEnv(): TelnyxTrunkService {
    return new TelnyxTrunkService(trunkConfig.telnyx);
  }
}
