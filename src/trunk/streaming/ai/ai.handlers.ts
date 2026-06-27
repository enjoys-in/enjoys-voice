// AI voice-agent MediaStreamHandlers: glue a brain to a live media session.
//
// Per call: resolve the brain, open its Transcriber, forward inbound audio to
// it, and on each final utterance run Responder (LLM) -> Synthesizer (TTS) ->
// session.sendAudio. The synthesizer returns 8 kHz mu-law, exactly what the
// provider expects, so no codec sits on this path.
//
// Two factories share one pipeline:
//   createAiHandlers(brain)             — one fixed brain for every call.
//   createAgentAwareHandlers(resolve)   — resolve a per-call brain from the
//                                         Stream's `agentId` parameter, so each
//                                         user's configured agent answers their
//                                         own calls.

import type { MediaSession, MediaStreamHandlers, StreamStartMeta } from "../types";
import {
  echoResponder,
  silentSynthesizer,
  type AiBrain,
  type Transcriber,
} from "./brain";
import { SpeechmaticsTranscriber } from "./speechmatics.transcriber";

interface CallState {
  transcriber: Transcriber;
  brain: AiBrain;
  closed: boolean;
}

/** A function that resolves the brain for a call from its stream metadata. */
export type BrainResolver = (meta: StreamStartMeta) => Promise<AiBrain> | AiBrain;

/**
 * Core pipeline shared by both factories. `resolveBrain` is invoked once per
 * call at stream start; everything after is identical regardless of how the
 * brain was chosen.
 */
function aiHandlers(resolveBrain: BrainResolver): MediaStreamHandlers {
  const calls = new Map<string, CallState>();

  async function speak(session: MediaSession, brain: AiBrain, text: string): Promise<void> {
    const audio = await brain.synthesizer.synthesize(text);
    if (audio.length) session.sendAudio(audio);
  }

  return {
    onStart: async (session, meta) => {
      let brain: AiBrain;
      try {
        brain = await resolveBrain(meta);
      } catch (err) {
        console.error(`❌ AI: failed to resolve agent — ${(err as Error).message}`);
        return;
      }
      const state: CallState = { transcriber: brain.createTranscriber(), brain, closed: false };
      calls.set(session.id, state);
      console.log(`🤖 AI: answering call ${session.callId ?? session.id}`);

      try {
        await state.transcriber.start(async (text) => {
          if (state.closed) return;
          console.log(`🗣️  caller: ${text}`);
          try {
            const reply = await brain.responder.respond(text);
            console.log(`🤖 ai: ${reply}`);
            if (reply) await speak(session, brain, reply);
          } catch (err) {
            console.error(`❌ AI: responder/tts failed — ${(err as Error).message}`);
          }
        });
        if (brain.greeting) await speak(session, brain, brain.greeting);
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

/** Build MediaStreamHandlers that run ONE fixed AI brain for every call. */
export function createAiHandlers(brain: AiBrain): MediaStreamHandlers {
  return aiHandlers(() => brain);
}

/**
 * Build MediaStreamHandlers that resolve a PER-CALL brain. `resolveBrain` is
 * given the stream metadata (including `parameters.agentId`) and returns the
 * brain to run; throw/return a fallback to handle a missing agent.
 */
export function createAgentAwareHandlers(resolveBrain: BrainResolver): MediaStreamHandlers {
  return aiHandlers(resolveBrain);
}

/**
 * Default brain: real Speechmatics speech-to-text + stub LLM/TTS so the pipeline
 * runs immediately. Swap `responder` / `synthesizer` for real vendors, or use a
 * per-user agent via createAgentAwareHandlers.
 */
export function createDefaultBrain(): AiBrain {
  return {
    createTranscriber: () => new SpeechmaticsTranscriber(),
    responder: echoResponder,
    synthesizer: silentSynthesizer,
    greeting: "Hello, thanks for calling. How can I help you today?",
  };
}
