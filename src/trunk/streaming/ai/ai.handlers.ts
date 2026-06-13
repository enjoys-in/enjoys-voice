// AI voice-agent MediaStreamHandlers: glue the brain to a Twilio media session.
//
// Per call: open a Transcriber, forward inbound audio to it, and on each final
// utterance run Responder (LLM) -> Synthesizer (TTS) -> session.sendAudio.
// The synthesizer returns mu-law, which is exactly what the provider expects, so
// no codec is involved on this path.

import type { MediaSession, MediaStreamHandlers } from "../types";
import {
  echoResponder,
  silentSynthesizer,
  type AiBrain,
  type Transcriber,
} from "./brain";
import { SpeechmaticsTranscriber } from "./speechmatics.transcriber";

interface CallState {
  transcriber: Transcriber;
  closed: boolean;
}

/** Build MediaStreamHandlers that run the given AI brain for every call. */
export function createAiHandlers(brain: AiBrain): MediaStreamHandlers {
  const calls = new Map<string, CallState>();

  async function speak(session: MediaSession, text: string): Promise<void> {
    const audio = await brain.synthesizer.synthesize(text);
    if (audio.length) session.sendAudio(audio);
  }

  return {
    onStart: async (session) => {
      const state: CallState = { transcriber: brain.createTranscriber(), closed: false };
      calls.set(session.id, state);
      console.log(`🤖 AI: answering call ${session.callId ?? session.id}`);

      try {
        await state.transcriber.start(async (text) => {
          if (state.closed) return;
          console.log(`🗣️  caller: ${text}`);
          const reply = await brain.responder.respond(text);
          console.log(`🤖 ai: ${reply}`);
          await speak(session, reply);
        });
        if (brain.greeting) await speak(session, brain.greeting);
      } catch (err) {
        console.error(`❌ AI: failed to start ASR — ${(err as Error).message}`);
      }
    },

    onAudio: (session, frame) => {
      calls.get(session.id)?.transcriber.pushAudio(frame.audio);
    },

    onStop: async (session) => {
      const state = calls.get(session.id);
      if (!state) return;
      state.closed = true;
      calls.delete(session.id);
      await state.transcriber.stop();
      console.log(`🤖 AI: call ${session.callId ?? session.id} ended`);
    },

    onError: (_session, err) => console.error(`❌ AI error: ${err.message}`),
  };
}

/**
 * Default brain: real Speechmatics speech-to-text + stub LLM/TTS so the pipeline
 * runs immediately. Swap `responder` / `synthesizer` for real vendors.
 */
export function createDefaultBrain(): AiBrain {
  return {
    createTranscriber: () => new SpeechmaticsTranscriber(),
    responder: echoResponder,
    synthesizer: silentSynthesizer,
    greeting: "Hello, thanks for calling. How can I help you today?",
  };
}
