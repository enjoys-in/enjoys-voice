// Speechmatics Text-to-Speech — REST client
// Quickstart: https://docs.speechmatics.com/text-to-speech/quickstart
//
// Endpoint:  POST https://preview.tts.speechmatics.com/generate/<voice_id>
// Auth:      Authorization: Bearer <API_KEY>
// Body:      { "text": "..." }
// Query:     ?output_format=wav_16000 (default) | pcm_16000
//
// TTS is in preview. No JS SDK exists yet, so this uses fetch directly
// (Bun/Node 18+ have global fetch). Output is 16 kHz, 16-bit, mono — ready to
// hand to FreeSWITCH as an IVR prompt / announcement.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/** Available Speechmatics voices. */
export type SpeechmaticsVoice = "sarah" | "theo" | "megan" | "jack";

/**
 * Output audio format:
 *  - `wav_16000`: complete WAV file with headers (default) — playable as-is.
 *  - `pcm_16000`: raw little-endian 16-bit PCM @ 16 kHz — for streaming.
 */
export type TTSOutputFormat = "wav_16000" | "pcm_16000";

export interface SpeechmaticsTTSOptions {
  /** API key from the Speechmatics portal. Defaults to SPEECHMATICS_API_KEY. */
  apiKey?: string;
  /** Override the base URL (e.g. a self-hosted deployment). */
  baseUrl?: string;
  /** Default voice for requests that don't specify one. */
  defaultVoice?: SpeechmaticsVoice;
}

export interface GenerateOptions {
  voice?: SpeechmaticsVoice;
  outputFormat?: TTSOutputFormat;
  /** Optional AbortSignal to cancel an in-flight request. */
  signal?: AbortSignal;
}

const DEFAULT_BASE_URL = "https://preview.tts.speechmatics.com/generate";

export class SpeechmaticsTTS {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly defaultVoice: SpeechmaticsVoice;

  constructor(options: SpeechmaticsTTSOptions = {}) {
    const apiKey = options.apiKey ?? process.env["SPEECHMATICS_API_KEY"];
    if (!apiKey) {
      throw new Error(
        "Speechmatics TTS: missing API key (set SPEECHMATICS_API_KEY or pass apiKey)"
      );
    }
    this.apiKey = apiKey;
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.defaultVoice = options.defaultVoice ?? "sarah";
  }

  private async request(text: string, opts: GenerateOptions): Promise<Response> {
    const voice = opts.voice ?? this.defaultVoice;
    const format = opts.outputFormat ?? "wav_16000";
    const url = `${this.baseUrl}/${voice}?output_format=${format}`;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
      signal: opts.signal,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(
        `Speechmatics TTS failed: ${res.status} ${res.statusText}${
          detail ? ` — ${detail}` : ""
        }`
      );
    }
    return res;
  }

  /** Synthesize `text` and return the full audio as a Buffer. */
  async generate(text: string, opts: GenerateOptions = {}): Promise<Buffer> {
    const res = await this.request(text, opts);
    return Buffer.from(await res.arrayBuffer());
  }

  /**
   * Synthesize `text` and write it to `outPath` (creates parent dirs).
   * Use `wav_16000` (default) for a directly playable IVR prompt file.
   */
  async generateToFile(
    text: string,
    outPath: string,
    opts: GenerateOptions = {}
  ): Promise<string> {
    const audio = await this.generate(text, opts);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, audio);
    return outPath;
  }

  /**
   * Synthesize `text` and return the raw response body stream so playback can
   * start before the full clip is generated (low-latency use cases).
   */
  async stream(
    text: string,
    opts: GenerateOptions = {}
  ): Promise<ReadableStream<Uint8Array>> {
    const res = await this.request(text, opts);
    if (!res.body) throw new Error("Speechmatics TTS: empty response body");
    return res.body;
  }
}

/** Shared instance using SPEECHMATICS_API_KEY from the environment. */
export const speechmaticsTTS = new SpeechmaticsTTS();
