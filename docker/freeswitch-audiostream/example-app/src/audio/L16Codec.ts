import type { IAudioCodec } from '@/core/interfaces';

// Normalizes mod_audio_stream frames to little-endian 16-bit PCM (what WAV and
// STT engines expect). mod_audio_stream emits native-endian (LE) SLIN, so this
// is a pass-through by default; enable swapping only if a specific build/host
// delivers big-endian frames (symptom: the recording is pure static).
export class L16Codec implements IAudioCodec {
  constructor(private readonly swapEndianness: boolean = false) {}

  decode(frame: Buffer): Buffer {
    if (!this.swapEndianness || frame.length < 2) return frame;
    // A trailing odd byte can't form a whole sample — drop it, don't corrupt.
    const usable = frame.length - (frame.length % 2);
    const out = Buffer.from(frame.subarray(0, usable));
    out.swap16();
    return out;
  }
}
