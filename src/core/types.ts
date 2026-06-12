export enum SipStatus {
  OK = 200,
  Trying = 100,
  Ringing = 180,
  SessionProgress = 183,
  RateLimited = 429,
  Forbidden = 403,
  NotFound = 404,
  RequestTimeout = 408,
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
  VoicemailCreated = 'voicemail:created',
  VoicemailRead = 'voicemail:read',
  VoicemailDeleted = 'voicemail:deleted',
}

/**
 * Job types handled by the write-behind queue. These string values are
 * persisted in Redis as part of each queued job, so they MUST remain stable.
 */
export enum WriteJob {
  CallUpsert = 'call.upsert',
  VoicemailCreate = 'voicemail.create',
  VoicemailRead = 'voicemail.read',
  VoicemailDelete = 'voicemail.delete',
}

export interface CallLog {
  id: string;
  from: string;
  to: string;
  fromName: string;
  status: 'ringing' | 'answered' | 'ended' | 'missed' | 'failed';
  direction: 'inbound' | 'outbound';
  startTime: string;
  endTime?: string;
  duration?: number;
  /** Local extension the `from` leg resolves to (undefined for external/PSTN). */
  fromExt?: string;
  /** Local extension the `to` leg resolves to (undefined for external/PSTN). */
  toExt?: string;
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
