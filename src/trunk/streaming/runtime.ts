// Media-streaming runtime: builds the WebSocket side (MediaStreamServer + the
// optional BrowserBridge) and selects handlers by MEDIA_STREAM_MODE.
//
// Shared by the live app (src/index.ts) and the standalone test harness so the
// handler/mode wiring lives in exactly one place. The HTTP side (the Twilio
// voice webhook) is a separate, pure Router mounted on whatever Express server
// is already running — see webhook.ts / createStreamingWebhookRouter().

import { MediaStreamServer } from "./media-stream.server";
import { BrowserBridge } from "./browser-bridge";
import { createAiHandlers, createDefaultBrain } from "./ai/ai.handlers";
import type { MediaStreamHandlers } from "./types";

export type MediaStreamMode = "log" | "bridge" | "ai";

export interface MediaStreamRuntime {
  readonly mode: MediaStreamMode;
  /** Present only in "bridge" mode (the browser-facing audio WS). */
  readonly bridge?: BrowserBridge;
  /** Start the media WS server (and bridge WS, in bridge mode). */
  start(): void;
  /** Stop all sockets this runtime opened. */
  stop(): void;
}

/** Demo handlers: log frame activity only. The default when no mode is set. */
function createLogHandlers(): MediaStreamHandlers {
  const frames = new Map<string, number>();
  return {
    onStart: (session, meta) => {
      frames.set(session.id, 0);
      console.log(
        `▶️  stream start id=${session.id} call=${session.callId ?? "?"} ` +
          `fmt=${meta.format?.encoding ?? "?"}@${meta.format?.sampleRate ?? "?"} ` +
          `tracks=[${meta.tracks.join(",")}]`,
      );
    },
    onAudio: (session) => {
      const n = (frames.get(session.id) ?? 0) + 1;
      frames.set(session.id, n);
      if (n === 1 || n % 50 === 0) console.log(`🔊 audio id=${session.id} frames=${n}`);
    },
    onDtmf: (session, digit) => console.log(`☎️  dtmf id=${session.id} digit=${digit}`),
    onMark: (session, name) => console.log(`🏷️  mark id=${session.id} name=${name}`),
    onStop: (session) => {
      console.log(`⏹️  stream stop id=${session.id} totalFrames=${frames.get(session.id) ?? 0}`);
      frames.delete(session.id);
    },
    onError: (session, err) =>
      console.error(`❌ media error id=${session?.id ?? "?"}: ${err.message}`),
  };
}

/**
 * Build the media-streaming WS runtime for the current MEDIA_STREAM_MODE:
 *   log    (default) log frame activity
 *   bridge send caller audio to a browser listener (also starts the bridge WS)
 *   ai     answer with the Speechmatics voice agent
 */
export function createMediaStreamRuntime(): MediaStreamRuntime {
  const mode = (process.env.MEDIA_STREAM_MODE || "log").toLowerCase() as MediaStreamMode;

  let bridge: BrowserBridge | undefined;
  let handlers: MediaStreamHandlers;
  if (mode === "bridge") {
    bridge = new BrowserBridge();
    handlers = bridge.handlers();
  } else if (mode === "ai") {
    handlers = createAiHandlers(createDefaultBrain());
  } else {
    handlers = createLogHandlers();
  }

  const media = new MediaStreamServer(handlers);
  return {
    mode,
    bridge,
    start() {
      media.start();
      bridge?.start();
    },
    stop() {
      media.stop();
      bridge?.stop();
    },
  };
}
