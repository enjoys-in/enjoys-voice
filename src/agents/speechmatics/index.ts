// Speechmatics agent — realtime Speech-to-Text (STT) + Text-to-Speech (TTS).
//
// Install: npm install @speechmatics/real-time-client @speechmatics/auth
//
// STT  → official realtime SDK (this file) or the raw ws client (./websocket).
// TTS  → REST client (./tts), re-exported below.
//
// Auth: set SPEECHMATICS_API_KEY in the environment.

import https from "node:https";
import fs from "node:fs";
import { createSpeechmaticsJWT } from "@speechmatics/auth";
import {
  RealtimeClient,
  type DiarizationConfig,
  type SpeakersResultItem,
} from "@speechmatics/real-time-client";

// Re-export TTS + the raw WebSocket STT client so consumers have one entry point.
export * from "./tts";
export { SpeechmaticsRealtimeClient } from "./websocket";

const apiKey = process.env["SPEECHMATICS_API_KEY"] as string;

/** Raw audio description for telephony / streamed PCM input. */
export interface RawAudioFormat {
  type: "raw";
  encoding: "pcm_f32le" | "pcm_s16le" | "mulaw";
  sample_rate: number;
}

export interface RealtimeSTTOptions {
  /** BCP-47 language tag. Default "en". */
  language?: string;
  /** Accuracy/latency tradeoff. Default "enhanced". */
  model?: "standard" | "enhanced";
  /** Emit interim (partial) transcripts as words arrive. Default true. */
  enablePartials?: boolean;
  /** Max delay (seconds) before a final transcript. Default 1.0. */
  maxDelay?: number;
  /** Speaker/channel diarization. Use "speaker" to label who said what. */
  diarization?: DiarizationConfig;
  /** Required for raw/streamed audio (e.g. FreeSWITCH RTP). Omit for file/auto. */
  audioFormat?: RawAudioFormat;
  /** JWT time-to-live in seconds. Default 60. */
  jwtTtl?: number;
  /** Called for every finalized transcript chunk. */
  onTranscript?: (text: string, raw: unknown) => void;
  /** Called for every interim transcript chunk. */
  onPartial?: (text: string, raw: unknown) => void;
  /** Called on a server Error message. */
  onError?: (error: unknown) => void;
}

/** Generate a short-lived JWT for a realtime Speechmatics session. */
export function getSpeechmaticsJWT(ttl = 60): Promise<string> {
  if (!apiKey) {
    throw new Error("Speechmatics: missing SPEECHMATICS_API_KEY");
  }
  return createSpeechmaticsJWT({ type: "rt", apiKey, ttl });
}

/**
 * Start a realtime STT session and return the connected client. The caller
 * drives audio via `client.sendAudio(chunk)` and stops with
 * `client.stopRecognition()`. Transcripts arrive through the provided callbacks.
 *
 * Example (FreeSWITCH telephony audio):
 *   const stt = await startRealtimeSTT({
 *     audioFormat: { type: "raw", encoding: "mulaw", sample_rate: 8000 },
 *     onPartial: (t) => process.stdout.write(`\r${t}`),
 *     onTranscript: (t) => console.log("\nFINAL:", t),
 *   });
 *   mediaStream.on("data", (chunk) => stt.sendAudio(chunk));
 *   mediaStream.on("end", () => stt.stopRecognition({ noTimeout: true }));
 */
export async function startRealtimeSTT(
  options: RealtimeSTTOptions = {}
): Promise<RealtimeClient> {
  const client = new RealtimeClient();

  client.addEventListener("receiveMessage", ({ data }) => {
    if (data.message === "AddTranscript") {
      options.onTranscript?.(data.metadata?.transcript ?? "", data);
    } else if (data.message === "AddPartialTranscript") {
      options.onPartial?.(data.metadata?.transcript ?? "", data);
    } else if (data.message === "Error") {
      options.onError?.(data);
    }
  });

  const jwt = await getSpeechmaticsJWT(options.jwtTtl ?? 60);

  await client.start(jwt, {
    transcription_config: {
      language: options.language ?? "en",
      model: options.model ?? "enhanced",
      enable_partials: options.enablePartials ?? true,
      max_delay: options.maxDelay ?? 1.0,
      ...(options.diarization ? { diarization: options.diarization } : {}),
    },
    ...(options.audioFormat ? { audio_format: options.audioFormat } : {}),
  });

  return client;
}

/**
 * Transcribe a local audio file (e.g. a voicemail WAV) end-to-end and resolve
 * with the full transcript. Streams the file faster-than-realtime in small
 * chunks (highWaterMark) to avoid overrunning the server's audio buffer.
 *
 * Example (voicemail-to-text):
 *   const text = await transcribeFile("./recordings/voicemail/123.wav");
 */
export async function transcribeFile(
  filePath: string,
  options: RealtimeSTTOptions = {}
): Promise<string> {
  let transcript = "";

  const client = await startRealtimeSTT({
    ...options,
    onTranscript: (text, raw) => {
      transcript += text;
      options.onTranscript?.(text, raw);
    },
  });

  // 4 KiB chunks: stream faster than real-time without flooding the socket.
  const fileStream = fs.createReadStream(filePath, { highWaterMark: 4096 });
  fileStream.on("data", (chunk) => client.sendAudio(chunk as Buffer));

  return new Promise<string>((resolve, reject) => {
    fileStream.on("end", () => {
      // noTimeout: wait for ALL buffered audio to be processed before closing.
      client
        .stopRecognition({ noTimeout: true })
        .then(() => resolve(transcript.trim()), reject);
    });
    fileStream.on("error", (err) => {
      client.stopRecognition().catch(() => {});
      reject(err);
    });
  });
}

/**
 * Transcribe a local audio file WITH speaker diarization and resolve with both
 * the transcript and the detected speaker labels. Useful for 2-party call
 * recordings (caller vs. callee).
 *
 * Example (call-recording diarization):
 *   const { transcript, speakers } = await transcribeFileWithSpeakers(
 *     "./recordings/call-42.wav"
 *   );
 */
export async function transcribeFileWithSpeakers(
  filePath: string,
  options: RealtimeSTTOptions = {}
): Promise<{ transcript: string; speakers: SpeakersResultItem[] }> {
  let transcript = "";

  const client = await startRealtimeSTT({
    ...options,
    diarization: options.diarization ?? "speaker",
    onTranscript: (text, raw) => {
      transcript += text;
      options.onTranscript?.(text, raw);
    },
  });

  const fileStream = fs.createReadStream(filePath, { highWaterMark: 4096 });
  fileStream.on("data", (chunk) => client.sendAudio(chunk as Buffer));

  const finished = new Promise<void>((resolve, reject) => {
    fileStream.on("end", () => {
      client.stopRecognition({ noTimeout: true }).then(() => resolve(), reject);
    });
    fileStream.on("error", reject);
  });

  // getSpeakers({ final: true }) resolves once the session is finished.
  const [, result] = await Promise.all([
    finished,
    client.getSpeakers({ final: true, timeout: 10000 }),
  ]);

  return { transcript: transcript.trim(), speakers: result.speakers };
}

/**
 * Transcribe an HTTP(S) audio stream end-to-end and resolve with the full
 * transcript. Handy for transcribing a stored recording URL or a live feed.
 */
export async function transcribeHttpStream(
  streamURL: string,
  options: RealtimeSTTOptions = {}
): Promise<string> {
  let transcript = "";

  const client = await startRealtimeSTT({
    ...options,
    onTranscript: (text, raw) => {
      transcript += text;
      options.onTranscript?.(text, raw);
    },
  });

  return new Promise<string>((resolve, reject) => {
    client.addEventListener("receiveMessage", ({ data }) => {
      if (data.message === "EndOfTranscript") resolve(transcript.trim());
      else if (data.message === "Error") reject(new Error(JSON.stringify(data)));
    });

    https
      .get(streamURL, (response) => {
        response.on("data", (chunk) => client.sendAudio(chunk));
        response.on("end", () => client.stopRecognition({ noTimeout: true }));
        response.on("error", (error) => {
          client.stopRecognition();
          reject(error);
        });
      })
      .on("error", (error) => {
        client.stopRecognition();
        reject(error);
      });
  });
}
