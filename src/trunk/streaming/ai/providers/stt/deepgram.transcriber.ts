// Deepgram real-time speech-to-text adapter (concrete Transcriber, provider
// "deepgram").
//
// Uses the already-installed `ws` package directly (no @deepgram/sdk dependency)
// to open Deepgram's live transcription socket. Telephony audio is 8 kHz mu-law,
// which Deepgram decodes natively (encoding=mulaw&sample_rate=8000), so no audio
// conversion is needed inbound — the same mu-law frames the media stream
// delivers are forwarded verbatim.

import { WebSocket } from "ws";
import type { Transcriber } from "../../brain";

export interface DeepgramTranscriberOptions {
  apiKey: string;
  /** ASR language (e.g. "en"). */
  language: string;
  /** Model id; empty = a sensible default. */
  model?: string;
}

const BASE = "wss://api.deepgram.com/v1/listen";

export class DeepgramTranscriber implements Transcriber {
  private ws?: WebSocket;
  private open = false;
  private readonly pending: Buffer[] = [];

  constructor(private readonly opts: DeepgramTranscriberOptions) {}

  async start(onFinal: (text: string) => void): Promise<void> {
    if (!this.opts.apiKey) throw new Error("DEEPGRAM_API_KEY is not set");

    const params = new URLSearchParams({
      model: this.opts.model || "nova-3",
      language: this.opts.language || "en",
      encoding: "mulaw",
      sample_rate: "8000",
      channels: "1",
      punctuate: "true",
      smart_format: "true",
      interim_results: "false",
    });

    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(`${BASE}?${params.toString()}`, {
        headers: { Authorization: `Token ${this.opts.apiKey}` },
      });
      this.ws = socket;

      socket.on("open", () => {
        this.open = true;
        // Flush any audio that arrived before the socket finished opening.
        for (const buf of this.pending) socket.send(buf);
        this.pending.length = 0;
        resolve();
      });

      socket.on("message", (raw: Buffer) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.type === "Results" || msg.channel) {
            const alt = msg.channel?.alternatives?.[0];
            const text = (alt?.transcript ?? "").trim();
            if (text && msg.is_final) onFinal(text);
          }
        } catch {
          /* ignore non-JSON keepalive frames */
        }
      });

      socket.on("error", (err: Error) => {
        if (!this.open) reject(err);
        else console.error(`❌ Deepgram STT: ${err.message}`);
      });
      socket.on("close", () => {
        this.open = false;
      });
    });
  }

  pushAudio(mulaw: Buffer): void {
    if (this.open && this.ws) this.ws.send(mulaw);
    else this.pending.push(mulaw);
  }

  async stop(): Promise<void> {
    if (!this.ws) return;
    this.open = false;
    try {
      // CloseStream tells Deepgram to flush, then we close the socket.
      this.ws.send(JSON.stringify({ type: "CloseStream" }));
    } catch {
      /* socket may already be closing */
    }
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
    this.ws = undefined;
  }
}
