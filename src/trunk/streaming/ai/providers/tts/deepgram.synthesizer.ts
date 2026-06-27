// Deepgram Aura text-to-speech synthesizer (provider "deepgram").
//
// Fetch-based REST — no SDK dependency. Deepgram can emit 8 kHz mu-law directly
// (encoding=mulaw&sample_rate=8000&container=none), which is EXACTLY the
// telephony format, so this path needs no resampling/transcoding at all.

import type { Synthesizer } from "../../brain";

export interface DeepgramSynthesizerOptions {
  apiKey: string;
  /** Aura voice/model, e.g. "aura-2-thalia-en". Empty = a sensible default. */
  voice: string;
}

const ENDPOINT = "https://api.deepgram.com/v1/speak";
const DEFAULT_MODEL = "aura-2-thalia-en";

export class DeepgramSynthesizer implements Synthesizer {
  constructor(private readonly opts: DeepgramSynthesizerOptions) {}

  async synthesize(text: string): Promise<Buffer> {
    if (!text.trim()) return Buffer.alloc(0);
    if (!this.opts.apiKey) throw new Error("DEEPGRAM_API_KEY is not set");

    const params = new URLSearchParams({
      model: this.opts.voice || DEFAULT_MODEL,
      encoding: "mulaw",
      sample_rate: "8000",
      container: "none",
    });

    const res = await fetch(`${ENDPOINT}?${params.toString()}`, {
      method: "POST",
      headers: {
        Authorization: `Token ${this.opts.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => res.statusText);
      throw new Error(`Deepgram TTS ${res.status}: ${detail.slice(0, 200)}`);
    }
    // Already 8 kHz mu-law — hand straight to the media stream.
    return Buffer.from(await res.arrayBuffer());
  }
}
