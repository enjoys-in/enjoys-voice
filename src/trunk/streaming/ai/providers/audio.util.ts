// Audio helpers for the AI TTS path: turn whatever a synthesis vendor returns
// (WAV containers, PCM16 at 16/22.05/24 kHz, etc.) into the 8 kHz mu-law the
// telephony media stream expects.
//
// Self-contained: builds on the G.711 codec in ../audio.codec (no deps). Deepgram
// can emit 8 kHz mu-law directly so it skips all of this; Sarvam/Speechmatics
// return WAV/PCM that needs parsing + resampling first.

import { pcm16ToMuLaw } from "../../audio.codec";

/** Parsed PCM payload extracted from a container (or raw PCM passthrough). */
export interface Pcm16Audio {
  /** Little-endian signed 16-bit PCM samples. */
  pcm: Buffer;
  sampleRate: number;
  channels: number;
}

/**
 * Parse a RIFF/WAVE buffer, returning its PCM16 data + format. Walks the chunk
 * list (so `fmt `/`data` order and extra chunks like `LIST` are tolerated).
 * Throws if the buffer is not PCM WAVE. Only 16-bit PCM is supported (what every
 * TTS vendor here emits).
 */
export function parseWav(buf: Buffer): Pcm16Audio {
  if (buf.length < 12 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("not a WAV (RIFF/WAVE) buffer");
  }
  let channels = 1;
  let sampleRate = 8000;
  let bitsPerSample = 16;
  let pcm: Buffer | undefined;

  let offset = 12;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt ") {
      channels = buf.readUInt16LE(body + 2) || 1;
      sampleRate = buf.readUInt32LE(body + 4) || 8000;
      bitsPerSample = buf.readUInt16LE(body + 14) || 16;
    } else if (id === "data") {
      pcm = buf.subarray(body, Math.min(body + size, buf.length));
    }
    // Chunks are word-aligned: an odd size carries a trailing pad byte.
    offset = body + size + (size & 1);
  }

  if (!pcm) throw new Error("WAV has no data chunk");
  if (bitsPerSample !== 16) throw new Error(`unsupported WAV bit depth: ${bitsPerSample}`);
  return { pcm, sampleRate, channels };
}

/** Mix interleaved multi-channel PCM16 down to mono by averaging channels. */
function toMono(pcm: Buffer, channels: number): Buffer {
  if (channels <= 1) return pcm;
  const frames = Math.floor(pcm.length / (2 * channels));
  const out = Buffer.allocUnsafe(frames * 2);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) sum += pcm.readInt16LE((i * channels + c) * 2);
    out.writeInt16LE(Math.round(sum / channels), i * 2);
  }
  return out;
}

/**
 * Resample mono PCM16 from `inRate` to `outRate` via linear interpolation.
 * Adequate for speech (8 kHz target); returns the input untouched when the rates
 * already match.
 */
export function resamplePcm16(pcm: Buffer, inRate: number, outRate: number): Buffer {
  if (inRate === outRate) return pcm;
  const inSamples = pcm.length >> 1;
  if (inSamples === 0) return Buffer.alloc(0);
  const outSamples = Math.max(1, Math.round((inSamples * outRate) / inRate));
  const out = Buffer.allocUnsafe(outSamples * 2);
  const ratio = (inSamples - 1) / Math.max(1, outSamples - 1);
  for (let i = 0; i < outSamples; i++) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const a = pcm.readInt16LE(idx * 2);
    const b = idx + 1 < inSamples ? pcm.readInt16LE((idx + 1) * 2) : a;
    out.writeInt16LE(Math.round(a + (b - a) * frac), i * 2);
  }
  return out;
}

/**
 * Convert arbitrary PCM16 audio to 8 kHz mono mu-law (telephony format): downmix
 * to mono, resample to 8 kHz, then G.711 mu-law encode.
 */
export function pcm16ToMulaw8k(audio: Pcm16Audio): Buffer {
  const mono = toMono(audio.pcm, audio.channels);
  const resampled = resamplePcm16(mono, audio.sampleRate, 8000);
  return pcm16ToMuLaw(resampled);
}

/** Convenience: parse a WAV container and emit 8 kHz mono mu-law. */
export function wavToMulaw8k(wav: Buffer): Buffer {
  return pcm16ToMulaw8k(parseWav(wav));
}
