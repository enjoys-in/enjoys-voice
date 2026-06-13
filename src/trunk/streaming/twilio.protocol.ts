// Twilio Media Streams wire protocol <-> normalized media types.
//
// Twilio sends newline-free JSON text frames over the WebSocket:
//   connected -> start -> media (repeated) -> [dtmf|mark] -> stop
// Audio payloads are base64-encoded 8 kHz mu-law by default. To play audio back
// (only on a bidirectional <Connect><Stream>) we send `media` frames with the
// same streamSid; `clear` flushes Twilio's outbound buffer; `mark` is acked when
// playback reaches it.
//
// Docs: https://www.twilio.com/docs/voice/media-streams/websocket-messages

import type { MediaFrame, StreamStartMeta } from "./types";

/** Map a Twilio mediaFormat.encoding string to our normalized encoding. */
function normalizeEncoding(encoding?: string): "mulaw" | "l16" {
  if (encoding === "audio/x-mulaw" || encoding === "mulaw") return "mulaw";
  return "l16";
}

/** Decode a Twilio `start` event into normalized stream metadata. */
export function decodeTwilioStart(msg: any): StreamStartMeta {
  const start = msg?.start ?? {};
  const fmt = start.mediaFormat ?? {};
  return {
    provider: "twilio",
    streamId: msg?.streamSid ?? start.streamSid ?? "",
    callId: start.callSid,
    tracks: Array.isArray(start.tracks) ? start.tracks : [],
    format: fmt.encoding
      ? {
          encoding: normalizeEncoding(fmt.encoding),
          sampleRate: Number(fmt.sampleRate) || 8000,
          channels: Number(fmt.channels) || 1,
        }
      : undefined,
    parameters: (start.customParameters ?? {}) as Record<string, string>,
  };
}

/** Decode a Twilio `media` event into a normalized audio frame (base64 -> bytes). */
export function decodeTwilioMedia(msg: any): MediaFrame {
  const m = msg?.media ?? {};
  return {
    track: m.track,
    audio: Buffer.from(m.payload ?? "", "base64"),
    timestamp: m.timestamp,
    sequence: msg?.sequenceNumber,
  };
}

/** Encode outbound audio as a Twilio `media` frame (plays back to the caller). */
export function encodeTwilioMedia(streamSid: string, audio: Buffer): string {
  return JSON.stringify({
    event: "media",
    streamSid,
    media: { payload: audio.toString("base64") },
  });
}

/** Encode a Twilio `clear` frame (flush buffered outbound audio for barge-in). */
export function encodeTwilioClear(streamSid: string): string {
  return JSON.stringify({ event: "clear", streamSid });
}

/** Encode a Twilio `mark` frame (acked by Twilio once playback reaches it). */
export function encodeTwilioMark(streamSid: string, name: string): string {
  return JSON.stringify({ event: "mark", streamSid, mark: { name } });
}
