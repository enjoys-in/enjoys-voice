import { BaseTrunkProvider } from "../base.trunk";
import { trunkConfig } from "../config";
import type { SipTrunkConfig, TrunkProviderName } from "../types";
import { SignalwireClient } from "./signalwire.client";

export interface SignalwireTrunkConfig {
  /** SignalWire Project ID (acts as the "account SID" in the compatibility API). */
  projectId: string;
  /** SignalWire API Token (acts as the "auth token" for HTTP Basic auth). */
  apiToken: string;
  /** SignalWire Space URL, e.g. `example.signalwire.com` (no scheme). */
  spaceUrl: string;
  /** SIP termination domain, e.g. `example.sip.signalwire.com`. */
  sipDomain: string;
  /** SIP transport. Default udp:5060. Use `tls` + port 5061 for encrypted trunking. */
  transport?: "udp" | "tcp" | "tls";
  port?: number;
  /** E.164 caller ID (a purchased SignalWire number). */
  callerId?: string;
  enabled?: boolean;
}

/**
 * SignalWire trunk provider. Outbound PSTN via SignalWire SIP termination
 * (`<space>.sip.signalwire.com`) plus a REST client for programmable voice/SMS
 * through the Twilio-compatible LaML API.
 *
 * Docs: https://developer.signalwire.com/rest/compatibility-api
 */
export class SignalwireTrunkService extends BaseTrunkProvider {
  readonly name: TrunkProviderName = "signalwire";
  readonly client: SignalwireClient;

  constructor(config: SignalwireTrunkConfig) {
    const sip: SipTrunkConfig = {
      host: config.sipDomain,
      port: config.port ?? 5060,
      transport: config.transport ?? "udp",
      callerId: config.callerId,
    };
    super(sip, config.enabled ?? true);
    this.client = new SignalwireClient({
      projectId: config.projectId,
      apiToken: config.apiToken,
      spaceUrl: config.spaceUrl,
    });
  }

  /** Build a SignalwireTrunkService from environment variables (see src/trunk/config.ts). */
  static fromEnv(): SignalwireTrunkService {
    return new SignalwireTrunkService(trunkConfig.signalwire);
  }
}
