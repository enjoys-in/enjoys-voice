// Speechmatics Realtime Transcription — raw WebSocket client (no SDK)
// Protocol: https://docs.speechmatics.com/api-ref/realtime-transcription-websocket
//
// Endpoint:  wss://eu.rt.speechmatics.com/v2/
// Auth:      Authorization: Bearer <temporary JWT>   (recommended)
//            For browsers, pass the JWT as a query param: wss://.../v2?jwt=<key>
//
// Message flow:
//   client → StartRecognition  →  server → RecognitionStarted
//   client → AddAudio (binary) →  server → AudioAdded { seq_no }
//   server → AddPartialTranscript / AddTranscript
//   client → EndOfStream { last_seq_no }
//   server → EndOfTranscript
//
// Install: the `ws` package is already a dependency of this project.

import { EventEmitter } from "node:events";
import { WebSocket } from "ws";

// ─── Protocol types ──────────────────────────────────────────────────────────

export interface AudioFormat {
  type: "raw" | "file";
  /** Required when type === "raw". */
  encoding?: "pcm_f32le" | "pcm_s16le" | "mulaw";
  /** Required when type === "raw". */
  sample_rate?: number;
}

export interface TranscriptionConfig {
  language: string;
  operating_point?: "standard" | "enhanced";
  /** Emit AddPartialTranscript messages as words are spoken. */
  enable_partials?: boolean;
  /** Max delay (seconds) before a final transcript is returned. */
  max_delay?: number;
  output_locale?: string;
  diarization?: "none" | "speaker";
  transcript_filtering_config?: {
    remove_disfluencies?: boolean;
  };
  [key: string]: unknown;
}

export interface TranscriptResult {
  type: "word" | "punctuation" | "speaker_change";
  start_time: number;
  end_time: number;
  is_eos?: boolean;
  alternatives?: Array<{
    content: string;
    confidence: number;
    language?: string;
    speaker?: string;
  }>;
}

export interface TranscriptMessage {
  message: "AddTranscript" | "AddPartialTranscript";
  format?: string;
  metadata: { transcript: string; start_time: number; end_time: number };
  results: TranscriptResult[];
}

interface ServerError {
  message: "Error";
  type: string;
  reason: string;
  code?: number;
  seq_no?: number;
}

interface ServerWarning {
  message: "Warning";
  type: string;
  reason: string;
  code?: number;
}

export interface SpeechmaticsClientOptions {
  /** Temporary JWT (preferred) or API key, used as the Bearer token. */
  token: string;
  /** Defaults to the EU realtime endpoint. */
  url?: string;
  audioFormat?: AudioFormat;
  transcriptionConfig?: TranscriptionConfig;
}

const DEFAULT_URL = "wss://eu.rt.speechmatics.com/v2/";

// ─── Client ──────────────────────────────────────────────────────────────────
//
// Events:
//   "open"        — WebSocket connected
//   "started"     — RecognitionStarted received (ready for audio)
//   "partial"     — AddPartialTranscript (TranscriptMessage)
//   "transcript"  — AddTranscript        (TranscriptMessage)
//   "info"        — Info message
//   "warning"     — Warning message
//   "error"       — Error message or transport error
//   "end"         — EndOfTranscript received
//   "close"       — WebSocket closed (code, reason)
export class SpeechmaticsRealtimeClient extends EventEmitter {
  private ws?: WebSocket;
  private readonly url: string;
  private readonly token: string;
  private readonly audioFormat: AudioFormat;
  private readonly transcriptionConfig: TranscriptionConfig;

  /** Number of AddAudio chunks sent; used as last_seq_no on EndOfStream. */
  private seqNo = 0;
  /** Highest seq_no confirmed by the server via AudioAdded. */
  private lastConfirmedSeqNo = 0;

  constructor(options: SpeechmaticsClientOptions) {
    super();
    this.token = options.token;
    this.url = options.url ?? DEFAULT_URL;
    this.audioFormat = options.audioFormat ?? {
      type: "raw",
      encoding: "pcm_s16le",
      sample_rate: 16000,
    };
    this.transcriptionConfig = options.transcriptionConfig ?? {
      language: "en",
      operating_point: "enhanced",
      enable_partials: true,
      max_delay: 1.0,
    };
  }

  /** Open the WebSocket and send StartRecognition. Resolves on RecognitionStarted. */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url, {
        headers: { Authorization: `Bearer ${this.token}` },
      });

      this.ws.on("open", () => {
        this.emit("open");
        this.send({
          message: "StartRecognition",
          audio_format: this.audioFormat,
          transcription_config: this.transcriptionConfig,
        });
      });

      this.ws.on("message", (raw: Buffer | string) => {
        let data: Record<string, unknown>;
        try {
          data = JSON.parse(raw.toString());
        } catch {
          return; // server only sends JSON to the client
        }
        this.handleMessage(data);
        if (data["message"] === "RecognitionStarted") resolve();
        if (data["message"] === "Error") {
          reject(new Error(`${data["type"]}: ${data["reason"]}`));
        }
      });

      this.ws.on("error", (err) => {
        this.emit("error", err);
        reject(err);
      });

      this.ws.on("close", (code: number, reason: Buffer) => {
        this.emit("close", code, reason.toString());
      });
    });
  }

  /** Send a chunk of raw audio (binary AddAudio). Increments the local seq_no. */
  sendAudio(chunk: Buffer): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("Speechmatics: socket is not open");
    }
    this.seqNo += 1;
    this.ws.send(chunk);
  }

  /** Declare no more audio; resolves once the server sends EndOfTranscript. */
  endStream(): Promise<void> {
    return new Promise((resolve) => {
      this.once("end", resolve);
      this.send({ message: "EndOfStream", last_seq_no: this.seqNo });
    });
  }

  /** Force-close the WebSocket without waiting for EndOfTranscript. */
  close(): void {
    this.ws?.close();
  }

  get confirmedSeqNo(): number {
    return this.lastConfirmedSeqNo;
  }

  private handleMessage(data: Record<string, unknown>): void {
    switch (data["message"]) {
      case "RecognitionStarted":
        this.emit("started", data);
        break;
      case "AudioAdded":
        this.lastConfirmedSeqNo = data["seq_no"] as number;
        break;
      case "AddPartialTranscript":
        this.emit("partial", data as unknown as TranscriptMessage);
        break;
      case "AddTranscript":
        this.emit("transcript", data as unknown as TranscriptMessage);
        break;
      case "EndOfTranscript":
        this.emit("end");
        break;
      case "Info":
        this.emit("info", data);
        break;
      case "Warning":
        this.emit("warning", data as unknown as ServerWarning);
        break;
      case "Error":
        this.emit("error", data as unknown as ServerError);
        break;
      default:
        break;
    }
  }

  private send(payload: Record<string, unknown>): void {
    this.ws?.send(JSON.stringify(payload));
  }
}

// ─── Example usage ───────────────────────────────────────────────────────────
// import { createSpeechmaticsJWT } from "@speechmatics/auth";
//
// const jwt = await createSpeechmaticsJWT({ type: "rt", apiKey: API_KEY, ttl: 60 });
// const client = new SpeechmaticsRealtimeClient({
//   token: jwt,
//   audioFormat: { type: "raw", encoding: "mulaw", sample_rate: 8000 }, // telephony
//   transcriptionConfig: { language: "en", operating_point: "enhanced", enable_partials: true },
// });
//
// client.on("partial", (m) => process.stdout.write(`\r${m.metadata.transcript}`));
// client.on("transcript", (m) => console.log("\nFINAL:", m.metadata.transcript));
// client.on("error", (e) => console.error("SM error:", e));
//
// await client.connect();
// freeswitchAudioStream.on("data", (chunk: Buffer) => client.sendAudio(chunk));
// freeswitchAudioStream.on("end", () => client.endStream());
