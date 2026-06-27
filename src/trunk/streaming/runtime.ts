// Media-streaming runtime: builds the WebSocket side (MediaStreamServer + the
// optional BrowserBridge) and selects handlers by MEDIA_STREAM_MODE.
//
// Shared by the live app (src/index.ts) so the handler/mode wiring lives in
// exactly one place. The HTTP side (the Twilio
// voice webhook) is a separate, pure Router mounted on whatever Express server
// is already running — see webhook.ts / createStreamingWebhookRouter().

import { MediaStreamServer } from "./media-stream.server";
import { BrowserBridge } from "./browser-bridge";
import {
  createAiHandlers,
  createAgentAwareHandlers,
  createDefaultBrain,
} from "./ai/ai.handlers";
import { buildBrainFromAgent } from "./ai/agent.brain";
import type { AgentRuntimeConfig } from "./ai/providers/types";
import type { MediaStreamHandlers } from "./types";

export type MediaStreamMode = "log" | "bridge" | "ai" | "auto";

/** Resolve a per-call agent config from the `agentId` stream parameter. */
export type AgentResolver = (agentId: string) => Promise<AgentRuntimeConfig | undefined>;

export interface MediaStreamRuntimeOptions {
  /**
   * Optional per-user agent resolver. When provided, AI calls build their brain
   * from the agent named by the stream's `agentId` parameter (falling back to
   * the default stub brain when absent/unknown). Omit for a single global brain.
   */
  resolveAgent?: AgentResolver;
}

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
 * Compose several handler sets into one that dispatches PER CALL. At stream
 * start the caller's `mode` parameter (set by the voice webhook, e.g. "bridge"
 * or "ai") picks which set owns that session; every later event for that
 * session is forwarded to the same set. Unknown/absent mode → `fallback`.
 */
export function createRoutingHandlers(
  routes: Record<string, MediaStreamHandlers>,
  fallback: string,
): MediaStreamHandlers {
  const owner = new Map<string, MediaStreamHandlers>();
  const pick = (mode: string | undefined): MediaStreamHandlers =>
    routes[mode ?? ""] ?? routes[fallback];

  return {
    onStart(session, meta) {
      const h = pick(meta.parameters?.mode);
      owner.set(session.id, h);
      console.log(`🔀 dispatch id=${session.id} mode=${meta.parameters?.mode || fallback}`);
      h.onStart?.(session, meta);
    },
    onAudio: (session, frame) => owner.get(session.id)?.onAudio?.(session, frame),
    onDtmf: (session, digit) => owner.get(session.id)?.onDtmf?.(session, digit),
    onMark: (session, name) => owner.get(session.id)?.onMark?.(session, name),
    onStop(session) {
      const h = owner.get(session.id);
      owner.delete(session.id);
      h?.onStop?.(session);
    },
    onError(session, err) {
      if (session && owner.has(session.id)) {
        owner.get(session.id)?.onError?.(session, err);
      } else {
        // Pre-start failure: no owner yet — notify each distinct set once.
        for (const h of new Set(Object.values(routes))) h.onError?.(session, err);
      }
    },
  };
}

/**
/**
 * Build the AI handler set. With a `resolveAgent` it is agent-aware (per-call
 * brain from the `agentId` parameter, default brain as fallback); without one it
 * runs a single global default brain.
 */
function buildAiHandlers(resolveAgent?: AgentResolver): MediaStreamHandlers {
  if (!resolveAgent) return createAiHandlers(createDefaultBrain());
  const fallback = createDefaultBrain();
  return createAgentAwareHandlers(async (meta) => {
    const agentId = meta.parameters?.agentId;
    if (!agentId) return fallback;
    try {
      const cfg = await resolveAgent(agentId);
      return cfg ? buildBrainFromAgent(cfg) : fallback;
    } catch (err) {
      console.error(`❌ AI: agent ${agentId} resolve failed — ${(err as Error).message}`);
      return fallback;
    }
  });
}

/**
 * Build the media-streaming WS runtime for the current MEDIA_STREAM_MODE:
 *   auto   (default) route each call by its `mode` param: bridge | ai
 *   bridge force every call to a browser listener (also starts the bridge WS)
 *   ai     force the voice agent for every call
 *   log    log frame activity only (no audio routing)
 */
export function createMediaStreamRuntime(
  opts: MediaStreamRuntimeOptions = {},
): MediaStreamRuntime {
  const mode = (process.env.MEDIA_STREAM_MODE || "auto").toLowerCase() as MediaStreamMode;

  let bridge: BrowserBridge | undefined;
  let handlers: MediaStreamHandlers;
  if (mode === "auto") {
    // Run BOTH stacks and dispatch per call. The browser-facing WS must be up
    // so "bridge" calls have somewhere to land.
    bridge = new BrowserBridge();
    handlers = createRoutingHandlers(
      {
        bridge: bridge.handlers(),
        ai: buildAiHandlers(opts.resolveAgent),
        log: createLogHandlers(),
      },
      "bridge",
    );
  } else if (mode === "bridge") {
    bridge = new BrowserBridge();
    handlers = bridge.handlers();
  } else if (mode === "ai") {
    handlers = buildAiHandlers(opts.resolveAgent);
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
