// Speechmatics text-to-speech synthesizer (provider "speechmatics").
//
// Fetch-based REST — no SDK dependency. Speechmatics TTS is a preview product;
// the endpoint is configurable via SPEECHMATICS_TTS_URL so this keeps working as
// the API stabilizes. The response is treated as WAV when it carries a RIFF
// header, otherwise as raw 16-bit PCM at SPEECHMATICS_TTS_SAMPLE_RATE; either way
// it is converted to telephony 8 kHz mu-law.

import type { Synthesizer } from "../../brain";
import { wavToMulaw8k, pcm16ToMulaw8k } from "../audio.util";

export interface SpeechmaticsSynthesizerOptions {
  apiKey: string;
  /** Voice id (vendor-specific). Empty = vendor default. */
  voice: string;
  language: string;
}

const DEFAULT_ENDPOINT = "https://preview.tts.speechmatics.com/generate";

export class SpeechmaticsSynthesizer implements Synthesizer {
  constructor(private readonly opts: SpeechmaticsSynthesizerOptions) {}

  async synthesize(text: string): Promise<Buffer> {
    if (!text.trim()) return Buffer.alloc(0);
    if (!this.opts.apiKey) throw new Error("SPEECHMATICS_API_KEY is not set");

    const endpoint = process.env.SPEECHMATICS_TTS_URL || DEFAULT_ENDPOINT;
    const body: Record<string, unknown> = { text };
    if (this.opts.voice) body.voice = this.opts.voice;

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.opts.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => res.statusText);
      throw new Error(`Speechmatics TTS ${res.status}: ${detail.slice(0, 200)}`);
    }

    const audio = Buffer.from(await res.arrayBuffer());
    if (audio.length === 0) return Buffer.alloc(0);
    if (audio.toString("ascii", 0, 4) === "RIFF") return wavToMulaw8k(audio);
    // Raw PCM16 fallback at the configured rate.
    const rate = parseInt(process.env.SPEECHMATICS_TTS_SAMPLE_RATE || "16000", 10) || 16000;
    return pcm16ToMulaw8k({ pcm: audio, sampleRate: rate, channels: 1 });
  }
}
