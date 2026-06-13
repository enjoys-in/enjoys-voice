// AI voice-agent contracts (the pluggable "brain").
//
// Goal 2 ("AI answers the caller"): the pipeline is
//
//   caller mu-law ──▶ Transcriber (speech-to-text) ──▶ text
//                                        │
//                            Responder (LLM) gives a reply
//                                        │
//   caller ◀── session.sendAudio ◀── Synthesizer (text-to-speech, mu-law)
//
// Only the Transcriber has a concrete implementation here (Speechmatics, since
// the dependency is already installed). Responder (LLM) and Synthesizer (TTS)
// are left as injectable seams — pick your own vendor/keys and plug them in.
// Trivial defaults are provided so the pipeline runs end-to-end immediately.

/** Streaming speech-to-text for one call. Receives 8 kHz mu-law audio frames. */
export interface Transcriber {
  /** Open the ASR session. `onFinal` fires for each finalized utterance. */
  start(onFinal: (text: string) => void): Promise<void>;
  /** Feed one inbound audio frame (mu-law, 8 kHz mono). */
  pushAudio(mulaw: Buffer): void;
  /** Close the ASR session. */
  stop(): Promise<void>;
}

/** Turns caller text into the agent's reply text (your LLM goes here). */
export interface Responder {
  respond(userText: string): Promise<string>;
}

/** Turns reply text into 8 kHz mu-law audio (your TTS goes here). */
export interface Synthesizer {
  /** Return mu-law 8 kHz mono audio. Empty buffer = nothing to play. */
  synthesize(text: string): Promise<Buffer>;
}

/** A complete voice agent: one transcriber per call + a responder + a synthesizer. */
export interface AiBrain {
  createTranscriber(): Transcriber;
  responder: Responder;
  synthesizer: Synthesizer;
  /** Optional line spoken once when the call connects. */
  greeting?: string;
}

// ─── Trivial defaults (so the pipeline runs without a real LLM/TTS) ──────

/** Default LLM stub: parrots the caller back. Replace with a real model. */
export const echoResponder: Responder = {
  async respond(userText: string): Promise<string> {
    return `You said: ${userText}`;
  },
};

/** Default TTS stub: logs the reply and plays nothing. Replace with real TTS. */
export const silentSynthesizer: Synthesizer = {
  async synthesize(text: string): Promise<Buffer> {
    console.log(`🔇 (no TTS) would speak: "${text}"`);
    return Buffer.alloc(0);
  },
};
