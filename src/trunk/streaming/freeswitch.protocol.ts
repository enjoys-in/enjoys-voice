// FreeSWITCH mod_audio_stream wire protocol adapter.
//
// mod_audio_stream sends raw L16 PCM binary frames (no JSON envelope) and
// receives JSON text frames back (delivered as mod_audio_stream::json events).
// The start/stop lifecycle is implicit: connection open = start, close = stop.

import { pcm16ToMuLaw } from './audio.codec';
import type { MediaFrame, StreamStartMeta } from './types';

/** Synthesize a StreamStartMeta from the URL path (UUID) and query params. */
export function decodeFsStart(urlPath: string, urlParams: Record<string, string>): StreamStartMeta {
  const uuid = urlPath.split('/').pop() || 'unknown';
  return {
    provider: 'freeswitch' as any,
    streamId: uuid,
    callId: uuid,
    tracks: ['inbound'],
    format: { encoding: 'l16', sampleRate: 16000, channels: 1 },
    parameters: urlParams,
  };
}

/** Convert a raw L16 PCM binary frame to a normalized MediaFrame with mu-law audio. */
export function decodeFsMedia(raw: Buffer): MediaFrame {
  return { audio: pcm16ToMuLaw(raw) };
}

/** Encode mu-law audio back to L16 PCM for playback (bidirectional, commercial only). */
export function encodeFsMedia(_streamId: string, _audio: Buffer): string {
  return '';
}

export function encodeFsClear(_streamId: string): string {
  return '';
}

export function encodeFsMark(_streamId: string, _name: string): string {
  return '';
}
