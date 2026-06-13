// Normalized, provider-agnostic media-streaming contracts.
//
// A provider (Twilio today) connects an audio WebSocket to our MediaStreamServer
// and exchanges raw call audio. These types translate each vendor's wire format
// into ONE shape so the internal system can consume/produce audio without caring
// who the carrier is.
//
// ISOLATION: nothing here is wired into the live SIP/IVR/HTTP app. The
// `MediaStreamHandlers` interface is the seam the internal system implements
// LATER to do something real with the audio.

import type { TrunkProviderName } from "../types";

/** Audio codec carried over the stream. */
export type MediaEncoding = "mulaw" | "l16";

/** Negotiated audio format reported by the provider at stream start. */
export interface MediaFormat {
  encoding: MediaEncoding;
  sampleRate: number;
  channels: number;
}

/** Metadata delivered when a stream begins (provider `start` event). */
export interface StreamStartMeta {
  provider: TrunkProviderName;
  /** Provider stream identifier (Twilio `streamSid`). */
  streamId: string;
  /** Provider call identifier (Twilio `callSid`), when present. */
  callId?: string;
  /** Audio tracks included in this stream (e.g. `["inbound"]`). */
  tracks: string[];
  /** Negotiated audio format, when the provider reports it. */
  format?: MediaFormat;
  /** Custom parameters attached to the stream instruction (e.g. routing hints). */
  parameters: Record<string, string>;
}

/** A single chunk of inbound call audio. */
export interface MediaFrame {
  /** Which track the audio came from, when provided. */
  track?: string;
  /** Decoded audio bytes in the stream's codec (e.g. 8 kHz mu-law). */
  audio: Buffer;
  /** Provider timestamp passthrough (ms since stream start), when present. */
  timestamp?: string;
  /** Provider sequence number passthrough, when present. */
  sequence?: string;
}

/**
 * A live media session. Handed to the handlers so the internal system can push
 * audio back (two-way) and control playback. This is the binding seam.
 */
export interface MediaSession {
  /** Our internal session id (stable for the socket's lifetime). */
  readonly id: string;
  readonly provider: TrunkProviderName;
  readonly streamId: string;
  readonly callId?: string;
  /** Play audio back to the caller. Requires a bidirectional stream. No-op if the socket closed. */
  sendAudio(audio: Buffer): void;
  /** Ask the provider to flush any buffered outbound audio (barge-in). */
  clearAudio(): void;
  /** Send a named mark; the provider acks when playback reaches it. */
  mark(name: string): void;
  /** Close the underlying socket. */
  close(): void;
}

/**
 * Hooks the internal system implements LATER to consume inbound audio and
 * produce outbound audio. All optional so the server runs (and can be tested)
 * with none of them. Identity/auth is handled before these fire.
 */
export interface MediaStreamHandlers {
  /** Stream began; `session` is now usable for playback. */
  onStart?(session: MediaSession, meta: StreamStartMeta): void;
  /** Inbound caller audio chunk. */
  onAudio?(session: MediaSession, frame: MediaFrame): void;
  /** Caller pressed a DTMF digit (in-band keypad). */
  onDtmf?(session: MediaSession, digit: string): void;
  /** Provider acked a previously-sent mark by name. */
  onMark?(session: MediaSession, name: string): void;
  /** Stream ended (provider `stop` or socket close). Fires at most once. */
  onStop?(session: MediaSession): void;
  /** Transport/parse error. `session` is undefined if it failed before start. */
  onError?(session: MediaSession | undefined, err: Error): void;
}
