// Abstractions the application is built against (Dependency Inversion): high-level
// policy (call flow, HTTP, WS) depends on these interfaces, not on concrete
// implementations, so any piece can be swapped without touching the callers.

import type { EslConnection } from '@/core/types';

export interface ILogger {
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
  /** Returns a logger that prefixes messages with an additional scope. */
  child(scope: string): ILogger;
}

/** Holds the live ESL connection for each active call UUID. */
export interface ICallRegistry {
  set(uuid: string, conn: EslConnection): void;
  get(uuid: string): EslConnection | undefined;
  delete(uuid: string): void;
  has(uuid: string): boolean;
  ids(): string[];
}

/** Normalizes raw mod_audio_stream frames into usable PCM. */
export interface IAudioCodec {
  decode(frame: Buffer): Buffer;
}

/** Persists a single call's PCM stream. */
export interface IRecorder {
  readonly filename: string | null;
  write(pcm: Buffer): void;
  close(): void;
}

/** Creates one recorder per call (Factory). */
export interface IRecorderFactory {
  create(uuid: string): IRecorder;
}

/** Plays synthesized speech back into a live call (the full-duplex return leg). */
export interface ITtsService {
  speak(uuid: string, text: string, voice?: string): boolean;
}

/** A startable/stoppable network server (Interface Segregation). */
export interface IServer {
  start(): void | Promise<void>;
  stop(): void | Promise<void>;
}

/** A decoded, little-endian PCM chunk handed to audio consumers. */
export interface AudioChunk {
  uuid: string;
  /** Interleaved 16-bit LE PCM (channels = `channels`). */
  pcm: Buffer;
  channels: number;
  sampleRate: number;
}

/**
 * A pluggable audio consumer (STT, VAD, analytics, ...). Register any number of
 * these on the AudioPipeline — "plug and play". Consumers are isolated: one
 * throwing does not affect the others.
 */
export interface IAudioConsumer {
  readonly name: string;
  onAudio(chunk: AudioChunk): void;
  /** Called once when a call's stream ends. */
  onClose?(uuid: string): void;
}
