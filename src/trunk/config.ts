// Centralized environment loading for PSTN trunk providers.
//
// All `process.env` access for trunks lives HERE (mirrors src/core/config.ts),
// so each provider's `fromEnv()` reads from a typed `trunkConfig` slice instead
// of touching `process.env` directly. Each slice matches that provider's
// `*TrunkConfig` interface so it can be passed straight to the constructor.

import type { TwilioTrunkConfig } from "./twilio/twilio.service";
import type { TelnyxTrunkConfig } from "./telnyx/telnyx.service";
import type { PlivoTrunkConfig } from "./plivo/plivo.service";
import type { VonageTrunkConfig } from "./vonage/vonage.service";

/** Coerce an env string to a SIP transport (undefined falls back to provider default). */
const asTransport = (v?: string): "udp" | "tcp" | "tls" | undefined =>
  v as "udp" | "tcp" | "tls" | undefined;

/** Parse an optional numeric env var (undefined falls back to provider default). */
const asPort = (v?: string): number | undefined => (v ? parseInt(v) : undefined);

/** A provider is opted-in only when its `<VENDOR>_ENABLED` env var is exactly "true". */
const isEnabled = (v?: string): boolean => v === "true";

export interface TrunkConfig {
  twilio: TwilioTrunkConfig;
  telnyx: TelnyxTrunkConfig;
  plivo: PlivoTrunkConfig;
  vonage: VonageTrunkConfig;
}

export const trunkConfig: TrunkConfig = {
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID ?? "",
    authToken: process.env.TWILIO_AUTH_TOKEN ?? "",
    sipDomain: process.env.TWILIO_SIP_DOMAIN ?? "",
    transport: asTransport(process.env.TWILIO_SIP_TRANSPORT),
    port: asPort(process.env.TWILIO_SIP_PORT),
    callerId: process.env.TWILIO_CALLER_ID,
    enabled: isEnabled(process.env.TWILIO_ENABLED),
  },
  telnyx: {
    apiKey: process.env.TELNYX_API_KEY ?? "",
    connectionId: process.env.TELNYX_CONNECTION_ID,
    sipHost: process.env.TELNYX_SIP_HOST,
    transport: asTransport(process.env.TELNYX_SIP_TRANSPORT),
    port: asPort(process.env.TELNYX_SIP_PORT),
    sipUsername: process.env.TELNYX_SIP_USERNAME,
    sipPassword: process.env.TELNYX_SIP_PASSWORD,
    callerId: process.env.TELNYX_CALLER_ID,
    enabled: isEnabled(process.env.TELNYX_ENABLED),
  },
  plivo: {
    authId: process.env.PLIVO_AUTH_ID ?? "",
    authToken: process.env.PLIVO_AUTH_TOKEN ?? "",
    sipHost: process.env.PLIVO_SIP_HOST,
    transport: asTransport(process.env.PLIVO_SIP_TRANSPORT),
    port: asPort(process.env.PLIVO_SIP_PORT),
    sipUsername: process.env.PLIVO_SIP_USERNAME,
    sipPassword: process.env.PLIVO_SIP_PASSWORD,
    callerId: process.env.PLIVO_CALLER_ID,
    enabled: isEnabled(process.env.PLIVO_ENABLED),
  },
  vonage: {
    applicationId: process.env.VONAGE_APPLICATION_ID,
    // VONAGE_PRIVATE_KEY may hold literal `\n` sequences in .env — unescape them.
    privateKey: process.env.VONAGE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    apiKey: process.env.VONAGE_API_KEY,
    apiSecret: process.env.VONAGE_API_SECRET,
    sipHost: process.env.VONAGE_SIP_HOST,
    transport: asTransport(process.env.VONAGE_SIP_TRANSPORT),
    port: asPort(process.env.VONAGE_SIP_PORT),
    callerId: process.env.VONAGE_CALLER_ID,
    enabled: isEnabled(process.env.VONAGE_ENABLED),
  },
};
