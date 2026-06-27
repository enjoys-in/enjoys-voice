// Sarvam text-to-speech synthesizer (provider "sarvam").
//
// Fetch-based REST — no SDK dependency. Strong for Indian languages/accents.
// Sarvam returns base64-encoded WAV; we request an 8 kHz sample rate and convert
// the WAV to telephony mu-law (resampling defensively if the vendor ignores the
// requested rate).

import type { Synthesizer } from "../../brain";
import { wavToMulaw8k } from "../audio.util";

export interface SarvamSynthesizerOptions {
  apiKey: string;
  /** Sarvam speaker id, e.g. "anushka". Empty = vendor default. */
  voice: string;
  /** Language tag (e.g. "hi-IN", "en"). Normalized to Sarvam's xx-IN form. */
  language: string;
}

const ENDPOINT = "https://api.sarvam.ai/text-to-speech";
const DEFAULT_MODEL = "bulbul:v2";

/** Sarvam wants a region-qualified code like "hi-IN" / "en-IN". */
function sarvamLanguage(lang: string): string {
  const t = (lang || "en").trim();
  if (t.includes("-")) return t;
  return `${t.toLowerCase()}-IN`;
}

export class SarvamSynthesizer implements Synthesizer {
  constructor(private readonly opts: SarvamSynthesizerOptions) {}

  async synthesize(text: string): Promise<Buffer> {
    if (!text.trim()) return Buffer.alloc(0);
    if (!this.opts.apiKey) throw new Error("SARVAM_API_KEY is not set");

    const body: Record<string, unknown> = {
      text,
      model: DEFAULT_MODEL,
      target_language_code: sarvamLanguage(this.opts.language),
      speech_sample_rate: 8000,
    };
    if (this.opts.voice) body.speaker = this.opts.voice;

    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "api-subscription-key": this.opts.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => res.statusText);
      throw new Error(`Sarvam TTS ${res.status}: ${detail.slice(0, 200)}`);
    }

    const data = (await res.json()) as { audios?: string[]; audio?: string };
    const b64 = data.audios?.[0] ?? data.audio ?? "";
    if (!b64) return Buffer.alloc(0);
    return wavToMulaw8k(Buffer.from(b64, "base64"));
  }
}
