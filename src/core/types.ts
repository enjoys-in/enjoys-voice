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
}

export interface SipUser {
  extension: string;
  username: string;
  password: string;
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
}

type IVRCallStateStatus = 'ivr' | 'queued' | 'connected' | 'voicemail' | 'ended';
export interface IVRCallState {
  callId: string;
  callerNumber: string;
  calledNumber: string;
  language: 'en' | 'hi';
  department?: string;
  status: IVRCallStateStatus;
  startTime: string;
}
