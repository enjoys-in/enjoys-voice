// Standalone runner for the media-streaming module.
//
// Boots BOTH isolated pieces on their own ports so the whole PSTN-audio path can
// be tested end-to-end WITHOUT touching the live SIP/IVR/HTTP app:
//   - media WebSocket server  (Twilio streams audio in/out)   :MEDIA_STREAM_WS_PORT
//   - voice webhook HTTP server (returns <Connect><Stream>)    :MEDIA_STREAM_WEBHOOK_PORT
//
// Run it directly:   bun run src/trunk/streaming/standalone.ts
// Expose it publicly (ngrok/Caddy) and point your Twilio number's Voice URL at
//   POST https://<public-host>/twilio/voice
// Set MEDIA_STREAM_ECHO=true to hear your own voice back (two-way proof).
//
// MEDIA_STREAM_MODE selects what happens to the caller's audio:
//   log    (default) just log frames; the internal system replaces this later
//   bridge send audio to a browser listener (Goal 1: a person listens/talks)
//   ai     answer with the voice agent      (Goal 2: speech -> AI -> speak back)

import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MediaStreamServer } from "./media-stream.server";
import { createStreamingWebhookRouter, buildMediaStreamUrl } from "./webhook";
import { streamingConfig } from "./config";
import { BrowserBridge } from "./browser-bridge";
import { createAiHandlers, createDefaultBrain } from "./ai/ai.handlers";
import type { MediaStreamHandlers } from "./types";

// Per-session inbound frame counters, so audio logging stays readable.
const frameCounts = new Map<string, number>();

const demoHandlers: MediaStreamHandlers = {
  onStart: (session, meta) => {
    frameCounts.set(session.id, 0);
    console.log(
      `▶️  stream start id=${session.id} call=${session.callId ?? "?"} ` +
        `fmt=${meta.format?.encoding ?? "?"}@${meta.format?.sampleRate ?? "?"} ` +
        `tracks=[${meta.tracks.join(",")}]`,
    );
  },
  onAudio: (session) => {
    const n = (frameCounts.get(session.id) ?? 0) + 1;
    frameCounts.set(session.id, n);
    // ~20 ms per Twilio frame => log roughly once per second.
    if (n === 1 || n % 50 === 0) {
      console.log(`🔊 audio id=${session.id} frames=${n}`);
    }
  },
  onDtmf: (session, digit) => console.log(`☎️  dtmf id=${session.id} digit=${digit}`),
  onMark: (session, name) => console.log(`🏷️  mark id=${session.id} name=${name}`),
  onStop: (session) => {
    console.log(
      `⏹️  stream stop id=${session.id} totalFrames=${frameCounts.get(session.id) ?? 0}`,
    );
    frameCounts.delete(session.id);
  },
  onError: (session, err) =>
    console.error(`❌ media error id=${session?.id ?? "?"}: ${err.message}`),
};

// ─── Pick the handler set by mode ────────────────────────────────────
const mode = (process.env.MEDIA_STREAM_MODE || "log").toLowerCase();

let handlers: MediaStreamHandlers = demoHandlers;
let bridge: BrowserBridge | undefined;

if (mode === "bridge") {
  bridge = new BrowserBridge();
  bridge.start(); // browser-facing audio WS on its own port
  handlers = bridge.handlers();
} else if (mode === "ai") {
  handlers = createAiHandlers(createDefaultBrain());
}

// ─── Media WebSocket server ──────────────────────────────────────────
const media = new MediaStreamServer(handlers);
media.start();
console.log(`   Mode       → ${mode}`);

// ─── Voice webhook HTTP server ───────────────────────────────────────
const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use("/twilio", createStreamingWebhookRouter());

// Bridge mode: serve the self-contained browser test page (listen / talk).
if (mode === "bridge") {
  const here = path.dirname(fileURLToPath(import.meta.url));
  app.get("/bridge", (_req, res) => {
    res.sendFile(path.join(here, "public", "bridge-test.html"));
  });
}
app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    mode,
    wsPort: streamingConfig.wsPort,
    bridgeWsPort: mode === "bridge" ? streamingConfig.bridgeWsPort : undefined,
    streamUrl: buildMediaStreamUrl(),
    echo: streamingConfig.echo,
    authRequired: !!streamingConfig.authToken,
  });
});

app.listen(streamingConfig.webhookPort, () => {
  console.log(
    `✅ Voice webhook: listening on :${streamingConfig.webhookPort} ` +
      `(POST /twilio/voice)`,
  );
  console.log(`   Stream URL → ${buildMediaStreamUrl()}`);
  console.log(`   Echo mode  → ${streamingConfig.echo ? "ON (two-way test)" : "off"}`);
  if (mode === "bridge") {
    console.log(
      `   Bridge test page → http://localhost:${streamingConfig.webhookPort}/bridge`,
    );
  }
});

// Graceful shutdown so the ports free up cleanly on Ctrl-C.
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.once(sig, () => {
    media.stop();
    bridge?.stop();
    process.exit(0);
  });
}
