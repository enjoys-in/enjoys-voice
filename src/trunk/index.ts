// PSTN trunk providers (Twilio, Telnyx, Plivo, Vonage).
//
// Each provider exposes a `*TrunkService` (SIP termination config + REST client)
// implementing the shared `ITrunkProvider` contract. They are self-contained and
// NOT yet wired into the SIP/IVR call flow — `createTrunkProvider()` is the seam
// for hooking them up later.

import type { ITrunkProvider, TrunkProviderName } from "./types";
import { TwilioTrunkService } from "./twilio";
import { TelnyxTrunkService } from "./telnyx";
import { PlivoTrunkService } from "./plivo";
import { VonageTrunkService } from "./vonage";

export * from "./types";
export { trunkConfig } from "./config";
export type { TrunkConfig } from "./config";
export { BaseTrunkProvider } from "./base.trunk";
export * from "./twilio";
export * from "./telnyx";
export * from "./plivo";
export * from "./vonage";

/**
 * Instantiate a trunk provider by name, configured from environment variables.
 * Returns `undefined` for unknown / not-yet-supported providers.
 */
export function createTrunkProvider(
  name: TrunkProviderName
): ITrunkProvider | undefined {
  switch (name) {
    case "twilio":
      return TwilioTrunkService.fromEnv();
    case "telnyx":
      return TelnyxTrunkService.fromEnv();
    case "plivo":
      return PlivoTrunkService.fromEnv();
    case "vonage":
      return VonageTrunkService.fromEnv();
    default:
      return undefined;
  }
}
