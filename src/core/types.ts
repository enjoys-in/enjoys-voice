export enum SipStatus {
  OK = 200,
  Trying = 100,
  Ringing = 180,
  SessionProgress = 183,
  RateLimited = 429,
  Forbidden = 403,
  NotFound = 404,
  RequestTimeout = 408,
  Gone = 410,
  TemporarilyUnavailable = 480,
  BusyHere = 486,
  RequestTerminated = 487,
  ServiceUnavailable = 503,
  Decline = 603,
  ServerError = 500,
}

/**
 * Events emitted by DatabaseService (an EventEmitter). The wiring layer listens
 * for these to mirror in-memory mutations to the shared Postgres database. The
 * ":" naming distinguishes them from write-queue job types (see WriteJob).
 */
export enum DbEvent {
  CallUpserted = 'call:upserted',
  /** A per-call charge to debit from a prepaid wallet (emitted at end-of-call
   * when prepaid billing is on and the call produced a non-zero cost). */
  BalanceDebit = 'balance:debit',
}

/**
 * Job types handled by the write-behind queue. These string values are
 * persisted in Redis as part of each queued job, so they MUST remain stable.
 */
export enum WriteJob {
  CallUpsert = 'call.upsert',
  BalanceDebit = 'balance.debit',
  /** A single signed outbound webhook delivery (POSTed off the call path). */
  WebhookDeliver = 'webhook.deliver',
}

/**
 * Payload for a prepaid wallet debit. The CallID makes the debit idempotent —
 * the writer applies it at most once per call even if the job is retried.
 */
export interface BalanceDebitJob {
  extension: string;
  callId: string;
  amount: number;
  currency: string;
}

/**
 * The JSON body POSTed to a subscriber's webhook URL. Self-describing: carries
 * the event name, a stable idempotency key (so receivers can de-duplicate
 * retries), the firing timestamp, the owner the webhook belongs to, and a
 * sanitized snapshot of the call.
 */
export interface WebhookCallSnapshot {
  id: string;
  from: string;
  to: string;
  fromName: string;
  direction: 'inbound' | 'outbound';
  status: string;
  startTime: string;
  endTime?: string;
  duration?: number;
  fromExt?: string;
  toExt?: string;
  cost?: number;
  currency?: string;
}

export interface WebhookEventPayload {
  event: string;
  idempotencyKey: string;
  timestamp: string;
  webhookId: number;
  owner: string;
  call: WebhookCallSnapshot;
}

/**
 * A single queued webhook delivery. Enqueued on the write-behind queue so the
 * HTTP POST never blocks the SIP/call path; the queue retries on failure. The
 * idempotencyKey (also echoed in the body + X-Idempotency-Key header) is stable
 * per (webhook, call, event) so both the queue and the receiver can de-dupe.
 */
export interface WebhookDeliverJob {
  webhookId: number;
  url: string;
  /** HMAC-SHA256 signing secret; empty string when the webhook is unsigned. */
  secret: string;
  event: string;
  idempotencyKey: string;
  body: WebhookEventPayload;
}

/**
 * Final outcome statuses written to a call record. Defined as a const object so
 * call sites reference a named, strongly-typed value instead of a bare string
 * literal scattered through the SIP/IVR code.
 */
export const CallStatus = {
  Ringing: 'ringing',
  Answered: 'answered',
  Ended: 'ended',
  Missed: 'missed',
  Failed: 'failed',
  Voicemail: 'voicemail',
  Unreachable: 'unreachable',
} as const;
export type CallStatus = (typeof CallStatus)[keyof typeof CallStatus];

/**
 * Why a call entered the offline/unreachable fallback chain
 * (SipServer.routeUnreachable). Controls voicemail gating + the spoken status
 * tone: only `Offline` may go to voicemail; `Busy`/`NoAnswer` play a tone and
 * are recorded as missed.
 */
export const UnreachableReason = {
  Busy: 'busy',
  NoAnswer: 'no_answer',
  Offline: 'offline',
} as const;
export type UnreachableReason = (typeof UnreachableReason)[keyof typeof UnreachableReason];

/** Direction of a call relative to our platform. */
export const CallDirection = {
  Inbound: 'inbound',
  Outbound: 'outbound',
} as const;
export type CallDirection = (typeof CallDirection)[keyof typeof CallDirection];

/**
 * Call-lifecycle events pushed to the caller over the signaling WebSocket
 * (SipServer.notifyFn). Named constants so producers don't sprinkle bare
 * string literals; the values are the wire contract the web client listens for.
 */
export const CallNotifyEvent = {
  Ringing: 'ringing',
  Answered: 'answered',
  Declined: 'declined',
  NoAnswer: 'no_answer',
  Forwarding: 'forwarding',
  Unavailable: 'unavailable',
  Failed: 'failed',
} as const;
export type CallNotifyEvent = (typeof CallNotifyEvent)[keyof typeof CallNotifyEvent];

/** Why a call-notify event fired (the `reason` field on the notify payload). */
export const CallNotifyReason = {
  Blocked: 'blocked',
  Busy: 'busy',
  PstnFailed: 'pstn_failed',
  Voicemail: 'voicemail',
  Dnd: 'dnd',
  Error: 'error',
  ForwardFailed: 'forward_failed',
} as const;
export type CallNotifyReason = (typeof CallNotifyReason)[keyof typeof CallNotifyReason];

export interface CallLog {
  id: string;
  from: string;
  to: string;
  fromName: string;
  status: CallStatus;
  direction: CallDirection;
  startTime: string;
  endTime?: string;
  duration?: number;
  /** Local extension the `from` leg resolves to (undefined for external/PSTN). */
  fromExt?: string;
  /** Local extension the `to` leg resolves to (undefined for external/PSTN). */
  toExt?: string;
  /** Billed amount for the call in the plan currency (0 when unrated/non-billable). */
  cost?: number;
  /** ISO-4217 currency the cost is denominated in (from the matched rate plan). */
  currency?: string;
  /** Leading E.164 digits of the rate that matched (audit/debug; undefined if none). */
  ratePrefix?: string;
  /** Duration actually billed in seconds (after increment rounding + minimum). */
  billedSecs?: number;
}

export interface Voicemail {
  id: string;
  mailbox: string;     // extension the message was left for
  from: string;        // caller number
  fromName: string;
  file: string;        // filename within the voicemail directory
  duration?: number;   // seconds
  createdAt: string;
  read: boolean;
}

export interface SipUser {
  extension: string;
  username: string;
  name: string;
  mobile?: string;
  registered?: boolean;
  contact?: string;
  userAgent?: string;
  blockedNumbers?: string[];
  forwardOnBusy?: string;
  forwardOnNoAnswer?: string;
  forwardOnUnavailable?: string;
  pstnForwardToBrowser?: boolean;
  pstnForwardTarget?: string; // extension or IVR number to forward inbound PSTN calls to
  /** Do Not Disturb: when true, inbound calls skip ringing → voicemail (or a
   * silent SIP 480 when voicemail is off). Intentional silence, NOT unreachable. */
  dnd?: boolean;
  /** Billing rate plan assigned to this user; undefined → workspace default plan. */
  ratePlanId?: number;
  /** Verified outbound caller ID (BYON) to present on browser→PSTN calls. Node
   * only ever receives this once the Go verify flow has confirmed ownership
   * (the SQL gates it on caller_id_verified), so its mere presence means trusted.
   * Undefined → fall back to the shared trunk caller number. */
  outboundCallerId?: string;
  /** Prepaid wallet balance in `balanceCurrency`. Hydrated from Postgres and
   * kept fresh via the settings_changed NOTIFY; only loaded when prepaid billing
   * is enabled. Undefined → treat as 0 / no wallet. */
  balance?: number;
  /** ISO-4217 currency the wallet balance is denominated in. */
  balanceCurrency?: string;
}

export interface SipRegistration {
  contact: string;
  expires: number;
  ua?: string;
  /** Source connection info from REGISTER request — used to route back through same transport */
  source?: {
    address: string;
    port: number;
    protocol: string;
  };
}

export interface Department {
  id: string;
  name: string;
  nameHi: string;
  agents: string[];
  queueName: string;
  maxWait: number;
  priority: number;
}type IVRCallStateStatus = 'ivr' | 'queued' | 'connected' | 'voicemail' | 'ended';
export interface IVRCallState {
  callId: string;
  callerNumber: string;
  calledNumber: string;
  language: 'en' | 'hi';
  department?: string;
  status: IVRCallStateStatus;
  startTime: string;
}
