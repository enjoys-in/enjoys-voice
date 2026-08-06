import express, { type Express, type Request, type Response } from 'express';
import path from 'node:path';
import type { Server as HttpNodeServer } from 'node:http';
import type { IServer, ITtsService, ICallRegistry, ILogger } from '@/core/interfaces';
import type { AppConfig } from '@/core/types';

const PROJECT_ROOT = path.join(__dirname, '..', '..');

// Serves the WebRTC softphone UI and the AI hooks:
//   POST /say   {uuid,text,voice}  -> speak into a live call
//   GET  /calls                    -> active call UUIDs
//   GET  /health                   -> liveness probe
export class HttpServer implements IServer {
  private readonly app: Express;
  private server?: HttpNodeServer;

  constructor(
    private readonly config: AppConfig,
    private readonly tts: ITtsService,
    private readonly registry: ICallRegistry,
    private readonly logger: ILogger
  ) {
    this.app = express();
    this.configure();
  }

  private configure(): void {
    this.app.use(express.json());

    // Never cache the softphone page, so config changes take effect on reload.
    const publicDir = path.join(PROJECT_ROOT, this.config.http.publicDir);
    this.app.use(
      express.static(publicDir, {
        etag: false,
        lastModified: false,
        setHeaders: (res) => res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate'),
      })
    );

    this.app.post('/say', (req: Request, res: Response) => {
      const { uuid, text, voice } = (req.body ?? {}) as {
        uuid?: string;
        text?: string;
        voice?: string;
      };
      if (!uuid || !text) {
        return res.status(400).json({ ok: false, error: 'uuid and text are required' });
      }
      const ok = this.tts.speak(uuid, text, voice);
      return res.status(ok ? 200 : 404).json({ ok, uuid });
    });

    this.app.get('/calls', (_req: Request, res: Response) => res.json(this.registry.ids()));
    this.app.get('/health', (_req: Request, res: Response) => res.json({ ok: true }));
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = this.app.listen(this.config.http.port, () => {
        this.logger.info(`Web UI + AI hooks on http://localhost:${this.config.http.port}`);
        this.logger.info('  POST /say  {"uuid":"...","text":"...","voice":"en_US-amy-medium"}');
        this.logger.info('  GET  /calls  -> active call UUIDs');
        resolve();
      });
    });
  }

  stop(): void {
    this.server?.close();
  }
}
