export interface User {
  extension: string;
  username: string;
  name: string;
  mobile?: string;
  avatar?: string;
}

export interface Contact {
  extension: string;
  name: string;
  username: string;
  online: boolean;
  registered: boolean;
}

export interface CallRecord {
  id: string;
  from: string;
  to: string;
  fromName: string;
  status: "ringing" | "answered" | "ended" | "missed" | "failed";
  direction: "inbound" | "outbound";
  startTime: string;
  endTime?: string;
  duration?: number;
}

export interface ActiveCall {
  callId: string;
  peerExtension: string;
  peerName: string;
  direction: "outbound" | "inbound";
  status: "dialing" | "ringing" | "connected" | "ended" | "declined" | "no_answer" | "blocked";
  startTime: number;
}

export interface ForwardingRules {
  busy?: string;
  noAnswer?: string;
  unavailable?: string;
}

export interface UserSettings {
  callerTune: string;
  ringtone: string;
  soundsEnabled: boolean;
  dtmfEnabled: boolean;
  pstnEnabled: boolean;
  pstnMobile?: string;
  pstnCountryCode?: string;
  pstnForwardToBrowser: boolean;
  pstnForwardTarget?: string;
  recordingEnabled: boolean;
  voicemailEnabled: boolean;
  forwarding: ForwardingRules;
  blockedNumbers: string[];
}

export interface SipConfig {
  wsUrl: string;
  sipWsUrl: string;
  domain: string;
}
