import type { MediaFrame, StreamStartMeta } from "./types";
import { randomUUID } from "node:crypto";

/**
 * Decode the initial FreeSWITCH mod_audio_stream connection frame.
 * Expected format: {"event": "connect", "callId": "<uuid>"}
 */
export function decodeFreeswitchStart(
  msg: any,
  urlParams: Record<string, string>,
): StreamStartMeta {
  // Use callId from JSON payload or fallback to UUID
  const callId = msg.callId || randomUUID();
  // We use the same UUID for the streamId since FreeSWITCH doesn't give us a separate one
  const streamId = msg.streamId || callId;

  return {
    provider: "freeswitch",
    streamId,
    callId,
    tracks: ["inbound"],
    format: {
      // By default we assume it's L16 (linear PCM) but usually we decode to what the engine needs.
      // Often mod_audio_stream defaults to 8k mono L16 PCM.
      encoding: "l16",
      sampleRate: 8000, // this might need to be dynamic or configured via url params
      channels: 1,
    },
    // We pass any parameters provided via the URL
    parameters: urlParams,
  };
}

/**
 * mod_audio_stream sends raw binary frames.
 * The server handles routing binary messages here.
 */
export function decodeFreeswitchMedia(msg: any): MediaFrame {
  // We expect the server to pass the binary payload wrapped in { payload: Buffer }
  const audio = msg.payload as Buffer;
  
  return {
    track: "inbound",
    audio,
  };
}

/**
 * mod_audio_stream community edition is uni-directional. 
 * We cannot send audio back.
 */
export function encodeFreeswitchMedia(streamId: string, audio: Buffer): string {
  throw new Error("FreeSWITCH mod_audio_stream community edition is uni-directional (cannot send media).");
}

export function encodeFreeswitchClear(streamId: string): string {
  throw new Error("FreeSWITCH mod_audio_stream community edition is uni-directional (cannot clear media).");
}

export function encodeFreeswitchMark(streamId: string, name: string): string {
  throw new Error("FreeSWITCH mod_audio_stream community edition is uni-directional (cannot send marks).");
}
