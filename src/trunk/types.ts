// Shared contracts for PSTN trunk providers (Twilio, Telnyx, Plivo, Vonage).
//
// These define ONE interface so providers are interchangeable when wired into
// call routing later. A provider is split into two parts:
//   - ITrunkClient   : pure REST transport (originate call, send SMS).
//   - ITrunkProvider : SIP termination config + the REST client.
//
// NOTE: these are created but NOT yet wired into the SIP/IVR flow.

/** Supported PSTN trunk providers. `custom` = the legacy generic SIP trunk. */
export type TrunkProviderName = "twilio" | "telnyx" | "plivo" | "vonage" | "custom" | "freeswitch";

/** Normalized SIP termination details for outbound routing via drachtio/FreeSWITCH. */
export interface SipTrunkConfig {
  /** SIP host the outbound INVITE is sent to (provider termination edge). */
  host: string;
  port: number;
  transport: "udp" | "tcp" | "tls";
  /** Optional digest auth (credential-based trunks). */
  username?: string;
  password?: string;
  /** E.164 caller ID presented on outbound calls. */
  callerId?: string;
  /** Dial prefix prepended before the destination number. */
  prefix?: string;
}

/** Options to originate (dial out) a PSTN call via the provider REST API. */
export interface OriginateCallOptions {
  /** Destination number (E.164 or local; normalized by the provider). */
  to: string;
  /** Caller ID. Defaults to the provider's configured callerId when omitted. */
  from?: string;
  /** URL the provider fetches call instructions from (TwiML / NCCO / Plivo XML). */
  answerUrl?: string;
  /** Inline call-control instructions, provider-specific (TwiML string / NCCO array). */
  instructions?: unknown;
}

/** Normalized result of an originate-call request. */
export interface CallResult {
  /** Provider call identifier (SID / UUID / request id). */
  id: string;
  /** Provider-reported status. */
  status: string;
  /** Full provider response for provider-specific fields. */
  raw: unknown;
}

/** Options to send an SMS via the provider REST API. */
export interface SendSmsOptions {
  to: string;
  from?: string;
  text: string;
}

/** Normalized result of an SMS send request. */
export interface SmsResult {
  id: string;
  status: string;
  raw: unknown;
}

/** Which audio direction(s) to fork onto the media WebSocket. */
export type MediaStreamTrack = "inbound" | "outbound" | "both";

/**
 * Options to start a real-time audio stream over a WebSocket. Every provider
 * forks live call audio to `wsUrl`; with `bidirectional` the provider also
 * plays back audio your socket sends, enabling AI voice agents / live TTS.
 */
export interface MediaStreamOptions {
  /** Secure WebSocket URL (wss://) the provider connects to and streams audio over. */
  wsUrl: string;
  /** Which audio track(s) to stream. Default "inbound". */
  track?: MediaStreamTrack;
  /** Two-way audio — provider plays audio your socket sends back. Default false. */
  bidirectional?: boolean;
  /** Optional stream name/identifier (Twilio/Plivo). */
  name?: string;
  /**
   * Audio content-type/codec hint. Provider default when omitted, e.g. Twilio
   * mulaw 8k, Telnyx PCMU 8k, Plivo `audio/x-l16;rate=8000`, Vonage
   * `audio/l16;rate=16000`.
   */
  contentType?: string;
  /** Extra metadata forwarded to your socket (Twilio <Parameter>, Vonage/Plivo headers). */
  parameters?: Record<string, string>;
}

/** Normalized result of starting a media stream. */
export interface StreamResult {
  id: string;
  status: string;
  raw: unknown;
}

/** REST API client every provider implements. Pure transport — no SIP logic. */
export interface ITrunkClient {
  readonly provider: TrunkProviderName;
  originateCall(options: OriginateCallOptions): Promise<CallResult>;
  sendSms(options: SendSmsOptions): Promise<SmsResult>;
  /**
   * Start a real-time audio WebSocket stream on an ACTIVE call via the provider
   * REST API (Twilio Streams / Telnyx streaming_start / Plivo Audio Streams /
   * Vonage NCCO transfer).
   */
  startMediaStream(callId: string, options: MediaStreamOptions): Promise<StreamResult>;
  /**
   * Build the provider-native call-control instruction that starts a media
   * stream (Twilio TwiML / Telnyx call params / Plivo XML / Vonage NCCO), for
   * use at originate or answer-webhook time. Pure — performs no network call.
   */
  buildStreamInstruction(options: MediaStreamOptions): unknown;
}

/** Trunk service every provider implements: SIP config + REST client access. */
export interface ITrunkProvider {
  readonly name: TrunkProviderName;
  readonly isEnabled: boolean;
  readonly client: ITrunkClient;
  /** SIP termination details for routing outbound PSTN via drachtio. */
  getSipConfig(): SipTrunkConfig;
  /** Build the outbound SIP URI for a destination number. */
  formatOutboundUri(number: string): string;
  /** Originate a call through the provider's REST API. */
  originateCall(options: OriginateCallOptions): Promise<CallResult>;
  /** Send an SMS through the provider's REST API. */
  sendSms(options: SendSmsOptions): Promise<SmsResult>;
  /** Start a real-time audio WebSocket stream on an active call. */
  startMediaStream(callId: string, options: MediaStreamOptions): Promise<StreamResult>;
  /** Build the provider-native call-control instruction that starts a media stream. */
  buildStreamInstruction(options: MediaStreamOptions): unknown;
}
