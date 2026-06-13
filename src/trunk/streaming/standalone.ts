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
// The demo handlers below just LOG; the internal system replaces them later.

import express from "express";
import { MediaStreamServer } from "./media-stream.server";
import { createStreamingWebhookRouter, buildMediaStreamUrl } from "./webhook";
import { streamingConfig } from "./config";
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

// ─── Media WebSocket server ──────────────────────────────────────────
const media = new MediaStreamServer(demoHandlers);
media.start();

// ─── Voice webhook HTTP server ───────────────────────────────────────
const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use("/twilio", createStreamingWebhookRouter());
app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    wsPort: streamingConfig.wsPort,
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
});

// Graceful shutdown so the ports free up cleanly on Ctrl-C.
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.once(sig, () => {
    media.stop();
    process.exit(0);
  });
}
