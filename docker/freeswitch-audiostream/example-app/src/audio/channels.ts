// Channel helpers for interleaved 16-bit little-endian PCM.
//
// In a stereo mod_audio_stream, channel 0 = caller (left) and channel 1 =
// callee/AI (right). STT should consume ONLY the caller channel so it never
// transcribes the AI's own voice.

// De-interleave a single channel out of interleaved PCM. For mono input the
// buffer is returned unchanged.
export function extractChannel(interleaved: Buffer, channel: number, channels: number): Buffer {
  if (channels <= 1 || channel >= channels) return interleaved;
  const frames = Math.floor(interleaved.length / (2 * channels));
  const out = Buffer.allocUnsafe(frames * 2);
  for (let i = 0; i < frames; i++) {
    out.writeInt16LE(interleaved.readInt16LE((i * channels + channel) * 2), i * 2);
  }
  return out;
}

// Convenience: the caller is always channel 0.
export function extractCaller(interleaved: Buffer, channels: number): Buffer {
  return extractChannel(interleaved, 0, channels);
}
