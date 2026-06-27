// Plivo Audio Streaming wire protocol <-> normalized media types.
//
// Plivo opens a WebSocket (from a `<Stream bidirectional="true">` element or the
// Audio Streams API) and sends newline-free JSON text frames:
//   start -> media (repeated) -> [dtmf] -> stop
// Audio payloads are base64-encoded 8 kHz mu-law. Unlike Twilio, Plivo does NOT
// deliver custom parameters in the `start` event, so the caller-supplied params
// (mode / agentId / extension) ride on the WebSocket URL query instead and are
// merged in by the media server.
//
// To play audio back on a bidirectional stream we send a `playAudio` event;
// `clearAudio` flushes Plivo's outbound buffer (barge-in); `checkpoint` is the
// rough analogue of a Twilio mark.
//
// Docs: https://www.plivo.com/docs/voice-agents/audio-streaming

import type { MediaFrame, StreamStartMeta } from "./types";

/** Map a Plivo mediaFormat.encoding string to our normalized encoding. */
function normalizeEncoding(encoding?: string): "mulaw" | "l16" {
  if (encoding === "audio/x-mulaw" || encoding === "mulaw") return "mulaw";
  return "l16";
}

/**
 * Decode a Plivo `start` event into normalized stream metadata. `urlParams` are
 * the WebSocket URL query pairs the webhook embedded (Plivo has no native custom
 * parameters), used to carry mode / agentId / extension into the runtime.
 */
export function decodePlivoStart(
  msg: any,
  urlParams: Record<string, string> = {},
): StreamStartMeta {
  const start = msg?.start ?? {};
  const fmt = start.mediaFormat ?? {};
  return {
    provider: "plivo",
    streamId: msg?.streamId ?? start.streamId ?? "",
    callId: start.callId,
    tracks: Array.isArray(start.tracks) ? start.tracks : [],
    format: fmt.encoding
      ? {
          encoding: normalizeEncoding(fmt.encoding),
          sampleRate: Number(fmt.sampleRate) || 8000,
          channels: Number(fmt.channels) || 1,
        }
      : undefined,
    parameters: urlParams,
  };
}

/** Decode a Plivo `media` event into a normalized audio frame (base64 -> bytes). */
export function decodePlivoMedia(msg: any): MediaFrame {
  const m = msg?.media ?? {};
  return {
    track: m.track,
    audio: Buffer.from(m.payload ?? "", "base64"),
    timestamp: m.timestamp,
    sequence: msg?.sequenceNumber,
  };
}

/** Encode outbound audio as a Plivo `playAudio` event (plays back to the caller). */
export function encodePlivoMedia(_streamId: string, audio: Buffer): string {
  return JSON.stringify({
    event: "playAudio",
    media: {
      contentType: "audio/x-mulaw",
      sampleRate: 8000,
      payload: audio.toString("base64"),
    },
  });
}

/** Encode a Plivo `clearAudio` event (flush buffered outbound audio for barge-in). */
export function encodePlivoClear(streamId: string): string {
  return JSON.stringify({ event: "clearAudio", streamId });
}

/** Encode a Plivo `checkpoint` event (rough analogue of a Twilio mark). */
export function encodePlivoMark(streamId: string, name: string): string {
  return JSON.stringify({ event: "checkpoint", streamId, name });
}
