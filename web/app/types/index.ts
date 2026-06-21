import type { CallDirection, CallRecordStatus, CallStatus } from "./enums";

export * from "./enums";

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
  status: CallRecordStatus;
  direction: CallDirection;
  startTime: string;
  endTime?: string;
  duration?: number;
  /** Billed amount for the call in `currency` (0 / absent when unrated). */
  cost?: number;
  /** ISO-4217 currency the cost is denominated in. */
  currency?: string;
}

export interface ActiveCall {
  callId: string;
  peerExtension: string;
  peerName: string;
  direction: CallDirection;
  status: CallStatus;
  startTime: number;
  /** Transport backing this call. Defaults to SIP; "bridge" = PSTN→browser media bridge; "conference" = multi-party room. */
  source?: "sip" | "bridge" | "conference";
  /** When source === "conference", the room id this call is joined to. */
  conferenceRoomId?: string;
}

/** A single member of a multi-party conference room (mirrors the server roster). */
export interface ConferenceParticipant {
  extension: string;
  name: string;
  state: "invited" | "ringing" | "joined" | "left";
  muted: boolean;
  isHost: boolean;
}

/** Live conference room snapshot pushed over the signaling socket. */
export interface ConferenceRoom {
  roomId: string;
  name: string;
  hostExtension: string;
  participants: ConferenceParticipant[];
}

/** An incoming invitation to join a conference room. */
export interface ConferenceInvite {
  roomId: string;
  name: string;
  from: string;
  fromName: string;
}

export interface ForwardingRules {
  busy?: string;
  noAnswer?: string;
  unavailable?: string;
}

export interface UserSettings {
  displayName?: string;
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
  dnd: boolean;
  forwarding: ForwardingRules;
  blockedNumbers: string[];
}

export interface SipConfig {
  wsUrl: string;
  sipWsUrl: string;
  domain: string;
}
