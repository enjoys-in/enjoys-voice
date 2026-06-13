// G.711 mu-law <-> linear PCM16 codec (self-contained, no dependencies).
//
// Twilio Media Streams carry 8 kHz mu-law audio. Browsers (Web Audio API) and
// most AI/TTS engines work in linear PCM, so the browser bridge transcodes:
//   inbound  Twilio mu-law  -> PCM16  -> browser
//   outbound browser PCM16   -> mu-law -> Twilio
//
// Implements the standard ITU-T G.711 mu-law algorithm (Sun g711.c reference).

const BIAS = 0x84;
const CLIP = 32635;

// exp_lut[(sample >> 7) & 0xFF] -> exponent segment, per the G.711 reference.
const EXP_LUT = (() => {
  const lut = new Uint8Array(256);
  lut[0] = 0;
  lut[1] = 0;
  for (let i = 2; i < 4; i++) lut[i] = 1;
  for (let i = 4; i < 8; i++) lut[i] = 2;
  for (let i = 8; i < 16; i++) lut[i] = 3;
  for (let i = 16; i < 32; i++) lut[i] = 4;
  for (let i = 32; i < 64; i++) lut[i] = 5;
  for (let i = 64; i < 128; i++) lut[i] = 6;
  for (let i = 128; i < 256; i++) lut[i] = 7;
  return lut;
})();

/** Encode one 16-bit linear sample to a mu-law byte. */
function encodeSample(sample: number): number {
  let sign = (sample >> 8) & 0x80;
  if (sign) sample = -sample;
  if (sample > CLIP) sample = CLIP;
  sample += BIAS;
  const exponent = EXP_LUT[(sample >> 7) & 0xff];
  const mantissa = (sample >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

/** Decode one mu-law byte to a 16-bit linear sample. */
function decodeSample(uVal: number): number {
  uVal = ~uVal & 0xff;
  let t = ((uVal & 0x0f) << 3) + BIAS;
  t <<= (uVal & 0x70) >> 4;
  return uVal & 0x80 ? BIAS - t : t - BIAS;
}

/** Pre-computed full 256-entry decode table (mu-law byte -> PCM16 sample). */
const DECODE_TABLE = (() => {
  const t = new Int16Array(256);
  for (let i = 0; i < 256; i++) t[i] = decodeSample(i);
  return t;
})();

/** Convert a buffer of mu-law bytes to little-endian PCM16 (2 bytes/sample). */
export function muLawToPcm16(mulaw: Buffer): Buffer {
  const out = Buffer.allocUnsafe(mulaw.length * 2);
  for (let i = 0; i < mulaw.length; i++) {
    out.writeInt16LE(DECODE_TABLE[mulaw[i]], i * 2);
  }
  return out;
}

/** Convert a buffer of little-endian PCM16 to mu-law bytes (1 byte/sample). */
export function pcm16ToMuLaw(pcm: Buffer): Buffer {
  const samples = pcm.length >> 1; // floor: ignore a trailing odd byte
  const out = Buffer.allocUnsafe(samples);
  for (let i = 0; i < samples; i++) {
    out[i] = encodeSample(pcm.readInt16LE(i * 2));
  }
  return out;
}
