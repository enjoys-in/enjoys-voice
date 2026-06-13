import express, { Application } from 'express';
import cors from 'cors';
import { createHandlers } from '@enjoys/exception';
import { config } from '@/core';
import { DatabaseService, TrunkService } from '@/services';
import { SipServer } from '@/sip';
import type { ITrunkProvider } from '@/trunk';
import { streamingConfig, createStreamingWebhookRouter } from '@/trunk/streaming';
import { createRoutes } from './routes/api.routes';
import { apiRateLimit } from './middleware/rate-limit';

// 404 (UnhandledRoutes) + central error (ExceptionHandler) middleware from
// @enjoys/exception. Built once and shared across instances.
const { UnhandledRoutes, ExceptionHandler } = createHandlers();

export class HttpServer {
  private app: Application;

  constructor(
    private db: DatabaseService,
    private trunk: TrunkService,
    private sip: SipServer,
    private trunkProvider?: ITrunkProvider,
  ) {
    this.app = express();
    this.configure();
  }

  private configure(): void {
    this.app.use(cors());
    this.app.use(express.json());

    // Twilio media-streaming voice webhook (+ /bridge test page), mounted on this
    // same Express server instead of a standalone one. Opt-in via MEDIA_STREAM_
    // ENABLED. Mounted BEFORE the rate limiter and /api/n dashboard router so the
    // unauthenticated Twilio webhook isn't throttled or blocked by API guards.
    //   Twilio Voice URL → https://<domain>/api/n/media/voice
    //   Browser test page → https://<domain>/api/n/media/bridge
    if (streamingConfig.enabled) {
      // Twilio POSTs application/x-www-form-urlencoded (To/From/RecordingUrl…),
      // so add a urlencoded parser scoped to this mount only.
      this.app.use(
        '/api/n/media',
        express.urlencoded({ extended: false }),
        createStreamingWebhookRouter({
          db: this.db,
          voicemailEnabled: config.voicemail.enabled,
          voicemailMaxSec: config.voicemail.maxSec,
        }),
      );
    }

    this.app.use(apiRateLimit);
    // Mounted under /api/n (Node) so a single domain can route both backends via
    // Caddy ( /api/n/* -> Node, /api/g/* -> Go ). Dev also separates by port 3001.
    this.app.use('/api/n', createRoutes(this.db, this.trunk, this.sip, this.trunkProvider));

    // Any request that fell through the routes above is unknown → throw a 404,
    // then format every error through the central handler. Mounted pathless
    // (NOT app.use('*', …), which throws under Express 5's path-to-regexp).
    this.app.use(UnhandledRoutes);
    this.app.use(ExceptionHandler);
  }

  start(): void {
    this.app.listen(config.server.httpPort, () => {
      console.log(`✅ HTTP: API server on port ${config.server.httpPort}`);
    });
  }
}
