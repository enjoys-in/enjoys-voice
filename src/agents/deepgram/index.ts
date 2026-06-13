// Deepgram Node SDK
// Docs: https://developers.deepgram.com/reference/deepgram-api-overview
//
// Install:
//   npm install @deepgram/sdk
//   npm install -D @types/node
//
// Auth: set DEEPGRAM_API_KEY in your environment.

import { readFileSync, createWriteStream } from "node:fs";
import {
  createClient,
  LiveTranscriptionEvents,
  type LiveSchema,
  type LiveClient,
} from "@deepgram/sdk";

const deepgram = createClient(process.env["DEEPGRAM_API_KEY"] as string);

// ─── 1. Live / streaming speech-to-text ──────────────────────────────────────
// Real-time transcription over a WebSocket. This is what you wire up to call
// audio (e.g. FreeSWITCH/Drachtio RTP -> linear16 frames -> connection.send()).
export function startLiveTranscription(): LiveClient {
  const options: LiveSchema = {
    model: "nova-3",
    language: "en",
    smart_format: true,
    interim_results: true,
    punctuate: true,
    // Tell Deepgram how to decode the raw call audio you forward below.
    encoding: "linear16",
    sample_rate: 16000,
    channels: 1,
  };

  const connection = deepgram.listen.live(options);

  connection.on(LiveTranscriptionEvents.Open, () => {
    console.log("Deepgram: connection open");
  });

  connection.on(LiveTranscriptionEvents.Transcript, (data) => {
    const alt = data.channel?.alternatives?.[0];
    if (!alt?.transcript) return;
    console.log(
      `[${data.is_final ? "final" : "interim"}] ${alt.transcript}`
    );
  });

  connection.on(LiveTranscriptionEvents.UtteranceEnd, (data) => {
    console.log("Deepgram: utterance end", data);
  });

  connection.on(LiveTranscriptionEvents.Metadata, (data) => {
    console.log("Deepgram: metadata", data);
  });

  connection.on(LiveTranscriptionEvents.Error, (err) => {
    console.error("Deepgram: error", err);
  });

  connection.on(LiveTranscriptionEvents.Close, () => {
    console.log("Deepgram: connection closed");
  });

  return connection;
}

// Forward raw audio chunks (Buffer / Uint8Array) from your media source.
export function sendAudioChunk(connection: LiveClient, chunk: Buffer): void {
  connection.send(chunk);
}

// Keep an idle stream alive (no audio for a while) without closing it.
export function keepAlive(connection: LiveClient): void {
  connection.keepAlive();
}

// Flush remaining audio and close the stream cleanly.
export function finishLiveTranscription(connection: LiveClient): void {
  connection.requestClose();
}

// ─── 2. Pre-recorded speech-to-text ──────────────────────────────────────────
// Transcribe a remote URL (e.g. a stored recording / voicemail).
export async function transcribeUrl(url: string) {
  const { result, error } = await deepgram.listen.prerecorded.transcribeUrl(
    { url },
    { model: "nova-3", smart_format: true }
  );
  if (error) throw error;
  return result.results.channels[0]?.alternatives[0]?.transcript ?? "";
}

// Transcribe a local file (e.g. ./recordings/voicemail/msg.wav).
export async function transcribeFile(path: string) {
  const { result, error } = await deepgram.listen.prerecorded.transcribeFile(
    readFileSync(path),
    { model: "nova-3", smart_format: true }
  );
  if (error) throw error;
  return result.results.channels[0]?.alternatives[0]?.transcript ?? "";
}

// ─── 3. Text-to-speech (Aura) ────────────────────────────────────────────────
// Synthesize speech for IVR prompts. Writes an audio file you can play back.
export async function synthesizeToFile(
  text: string,
  outPath = "tts.wav"
): Promise<string> {
  const response = await deepgram.speak.request(
    { text },
    {
      model: "aura-2-thalia-en",
      encoding: "linear16",
      container: "wav",
      sample_rate: 16000,
    }
  );

  const stream = await response.getStream();
  if (!stream) throw new Error("Deepgram: no TTS audio stream returned");

  const file = createWriteStream(outPath);
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    file.write(value);
  }
  file.end();

  return outPath;
}
