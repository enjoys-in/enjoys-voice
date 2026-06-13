/**
 * Strongly-typed enumerations for the call domain.
 *
 * These use the `const` object + derived union pattern (instead of TS `enum`)
 * so each name is usable both as a runtime value (e.g. `CallStatus.Connected`)
 * and as a type (e.g. `status: CallStatus`), while staying tree-shakeable and
 * fully type-safe. They are the single source of truth for the string literals
 * shared across hooks, stores and components.
 */

/** Lifecycle state of the active (in-progress) call. */
export const CallStatus = {
  Dialing: "dialing",
  Ringing: "ringing",
  Connected: "connected",
  Ended: "ended",
  Declined: "declined",
  NoAnswer: "no_answer",
  Blocked: "blocked", 
 
} as const;
export type CallStatus = (typeof CallStatus)[keyof typeof CallStatus];

/** Direction of a call relative to the local user. */
export const CallDirection = {
  Inbound: "inbound",
  Outbound: "outbound",
} as const;
export type CallDirection = (typeof CallDirection)[keyof typeof CallDirection];

/** Status of a persisted call-history record (server-side CDR). */
export const CallRecordStatus = {
  Ringing: "ringing",
  Answered: "answered",
  Ended: "ended",
  Missed: "missed",
  Failed: "failed",
  Voicemail: "voicemail",
  Unreachable: "unreachable",
} as const;
export type CallRecordStatus = (typeof CallRecordStatus)[keyof typeof CallRecordStatus];

/** Progress / feedback tones played locally during call setup. */
export const Tone = {
  Dialing: "dialing",
  Ringback: "ringback",
  Ringtone: "ringtone",
  Busy: "busy",
} as const;
export type Tone = (typeof Tone)[keyof typeof Tone];
/** A tone selection, or `null` when nothing is playing. */
export type ToneType = Tone | null;

/** Public paths to the bundled call audio assets (served from `/public`). */
export const SoundFile = {
  Ringtone: "/sounds/ringtone.wav",
  Ringback: "/sounds/ringback.wav",
  CallerTune: "/sounds/caller_tune.wav",
  BusyTone: "/sounds/busy_tone.wav",
} as const;
export type SoundFile = (typeof SoundFile)[keyof typeof SoundFile];
