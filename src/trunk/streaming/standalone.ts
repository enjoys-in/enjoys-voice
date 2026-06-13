// OPTIONAL isolated test harness for the media-streaming module.
//
// The REAL integration now lives in the live app:
//   - src/index.ts boots the media WS server (createMediaStreamRuntime)
//   - src/http/http.server.ts mounts the voice webhook on the EXISTING Express
//     at /api/n/media (no separate Express in production).
//
// Use THIS file only to exercise the streaming module on its own — without
// booting Postgres / Valkey / SIP / drachtio:
//   MEDIA_STREAM_MODE=bridge bun run src/trunk/streaming/standalone.ts
//
// It reuses the exact same runtime + webhook router as the live app; the tiny
// Express here exists solely to host the webhook when the main server isn't up.

import express from "express";
import { createMediaStreamRuntime } from "./runtime";
import { createStreamingWebhookRouter, buildMediaStreamUrl } from "./webhook";
import { streamingConfig } from "./config";

// Media WS server (+ bridge WS in bridge mode) — same wiring as the live app.
const runtime = createMediaStreamRuntime();
runtime.start();
console.log(`   Mode       → ${runtime.mode}`);

// Minimal Express just to host the webhook + test page in isolation.
const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use("/twilio", createStreamingWebhookRouter()); // /twilio/voice + /twilio/bridge
app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    mode: runtime.mode,
    wsPort: streamingConfig.wsPort,
    bridgeWsPort: runtime.mode === "bridge" ? streamingConfig.bridgeWsPort : undefined,
    streamUrl: buildMediaStreamUrl(),
    echo: streamingConfig.echo,
    authRequired: !!streamingConfig.authToken,
  });
});

app.listen(streamingConfig.webhookPort, () => {
  console.log(
    `✅ Voice webhook: listening on :${streamingConfig.webhookPort} (POST /twilio/voice)`,
  );
  console.log(`   Stream URL → ${buildMediaStreamUrl()}`);
  console.log(`   Echo mode  → ${streamingConfig.echo ? "ON (two-way test)" : "off"}`);
  if (runtime.mode === "bridge") {
    console.log(
      `   Bridge test page → http://localhost:${streamingConfig.webhookPort}/twilio/bridge`,
    );
  }
});

// Graceful shutdown so the ports free up cleanly on Ctrl-C.
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.once(sig, () => {
    runtime.stop();
    process.exit(0);
  });
}
