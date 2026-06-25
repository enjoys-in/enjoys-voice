import type { CallDirection, CallRecordStatus, CallStatus } from "./enums";

export * from "./enums";

export interface User {
  extension: string;
  username: string;
  name: string;
  mobile?: string;
  avatar?: string;
  // True when this user is a server-side admin (ADMIN_EXTENSIONS). Drives the
  // admin/user navigation split; populated by the /auth/me refresh.
  isAdmin?: boolean;
}

export interface Contact {
  // Present only for personal address-book entries (backend row id); the global
  // SIP directory entries (presence) have no id.
  id?: number;
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

/** Agent availability within a call queue (mirrors the server ACD states). */
export type QueueAgentState = "offline" | "available" | "ringing" | "busy" | "paused";

/** State of a caller waiting in (or connected through) a queue. */
export type QueueCallerState = "waiting" | "ringing" | "connected";

/** Distribution policy used to pick the next agent for a waiting caller. */
export type QueueStrategy = "longest-idle" | "round-robin" | "sequential";

/** A queue agent as shown on the supervisor dashboard. */
export interface QueueAgentSnapshot {
  extension: string;
  name: string;
  state: QueueAgentState;
  paused: boolean;
  callsHandled: number;
}

/** A caller waiting in (or connected through) a queue. */
export interface QueueCallerSnapshot {
  id: string;
  from: string;
  fromName: string;
  state: QueueCallerState;
  agent?: string;
  /** Seconds the caller has been waiting (at snapshot time). */
  waitingSecs: number;
}

/** Live snapshot of one call queue pushed over the signaling socket. */
export interface QueueSnapshot {
  id: string;
  name: string;
  strategy: QueueStrategy;
  agents: QueueAgentSnapshot[];
  callers: QueueCallerSnapshot[];
  stats: {
    waiting: number;
    connected: number;
    agentsAvailable: number;
    agentsTotal: number;
    longestWaitSecs: number;
  };
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
