// Speechmatics real-time speech-to-text adapter (concrete Transcriber).
//
// Uses the already-installed @speechmatics/real-time-client. Twilio sends 8 kHz
// mu-law, which Speechmatics accepts natively (encoding: "mulaw"), so no audio
// conversion is needed on the way in.

import { RealtimeClient } from "@speechmatics/real-time-client";
import { createSpeechmaticsJWT } from "@speechmatics/auth";
import { streamingConfig } from "../config";
import type { Transcriber } from "./brain";

export class SpeechmaticsTranscriber implements Transcriber {
  private client?: RealtimeClient;
  private active = false;

  /** @param languageOverride per-agent ASR language; falls back to config. */
  constructor(private readonly languageOverride?: string) {}

  async start(onFinal: (text: string) => void): Promise<void> {
    const { speechmaticsApiKey, speechmaticsUrl, language } = streamingConfig.ai;
    if (!speechmaticsApiKey) {
      throw new Error("SPEECHMATICS_API_KEY is not set");
    }

    const jwt = await createSpeechmaticsJWT({ type: "rt", apiKey: speechmaticsApiKey });
    this.client = new RealtimeClient(speechmaticsUrl ? { url: speechmaticsUrl } : undefined);

    this.client.addEventListener("receiveMessage", ({ data }) => {
      if (data.message === "AddTranscript") {
        const text = data.metadata.transcript.trim();
        if (text) onFinal(text);
      } else if (data.message === "Error") {
        console.error(`❌ Speechmatics: ${data.type} ${data.reason ?? ""}`);
      }
    });

    await this.client.start(jwt, {
      transcription_config: { language: this.languageOverride || language, enable_partials: false },
      audio_format: { type: "raw", encoding: "mulaw", sample_rate: 8000 },
    });
    this.active = true;
  }

  pushAudio(mulaw: Buffer): void {
    if (this.active) this.client?.sendAudio(mulaw);
  }

  async stop(): Promise<void> {
    if (!this.client || !this.active) return;
    this.active = false;
    try {
      await this.client.stopRecognition();
    } catch {
      /* socket may already be closing */
    }
    this.client = undefined;
  }
}
