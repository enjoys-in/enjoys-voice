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
  registered?: boolean;
  contact?: string;
  userAgent?: string;
  blockedNumbers?: string[];
  forwardOnBusy?: string;
  forwardOnNoAnswer?: string;
  forwardOnUnavailable?: string;
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

export interface IVRCallState {
  callId: string;
  callerNumber: string;
  calledNumber: string;
  language: 'en' | 'hi';
  department?: string;
  status: 'ivr' | 'queued' | 'connected' | 'voicemail' | 'ended';
  startTime: string;
}
