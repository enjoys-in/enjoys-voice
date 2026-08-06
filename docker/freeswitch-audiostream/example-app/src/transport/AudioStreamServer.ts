import { WebSocketServer, WebSocket, type RawData } from 'ws';
import type { IncomingMessage } from 'node:http';
import type {
  IServer,
  IRecorderFactory,
  IAudioCodec,
  ILogger,
} from '@/core/interfaces';
import type { AppConfig } from '@/core/types';
import type { AudioPipeline } from '@/audio/AudioPipeline';

// Receives the caller's forked audio from mod_audio_stream. The connection URL
// carries the call UUID (ws://<host>:<port>/<uuid>) so each stream maps to its
// call. Decoded little-endian PCM is recorded and fanned out to the audio
// pipeline (STT/VAD/analytics consumers); reply into the call via ITtsService.
export class AudioStreamServer implements IServer {
  private wss?: WebSocketServer;

  constructor(
    private readonly config: AppConfig,
    private readonly recorders: IRecorderFactory,
    private readonly codec: IAudioCodec,
    private readonly logger: ILogger,
    private readonly pipeline?: AudioPipeline
  ) {}

  start(): void {
    this.wss = new WebSocketServer({ host: '0.0.0.0', port: this.config.ws.port }, () => {
      this.logger.info(`Audio receiver on ws://0.0.0.0:${this.config.ws.port}/<uuid>`);
    });
    this.wss.on('connection', (ws, req) => this.handleConnection(ws, req));
    this.wss.on('error', (err) => this.logger.error('Server error:', err.message));
  }

  stop(): void {
    this.wss?.close();
  }

  private handleConnection(ws: WebSocket, req: IncomingMessage): void {
    const uuid = (req.url ?? '/').replace(/^\//, '') || 'unknown';
    const recorder = this.recorders.create(uuid);
    const channels = this.config.audio.channels === 'stereo' ? 2 : 1;
    let pktCount = 0;
    if (recorder.filename) this.logger.info(`Recording caller audio to ${recorder.filename}`);

    ws.on('message', (data: RawData, isBinary: boolean) => {
      if (!isBinary) {
        // Text frames are mod_audio_stream control/event JSON.
        this.logger.info(`Control frame (${uuid}): ${String(data)}`);
        return;
      }
      const frame = this.toBuffer(data);
      if (frame.length === 0) return;

      const pcm = this.codec.decode(frame);
      recorder.write(pcm);
      this.pipeline?.push({ uuid, pcm, channels, sampleRate: this.config.audio.sampleRate });

      if (++pktCount % 100 === 0) {
        this.logger.info(`${uuid}: ${pktCount} audio packets received`);
      }
    });

    ws.on('close', () => {
      recorder.close();
      this.pipeline?.close(uuid);
      this.logger.info(
        `Stream closed (${uuid}).${recorder.filename ? ` Saved ${recorder.filename}` : ''}`
      );
    });

    ws.on('error', (err) => this.logger.error(`error (${uuid}): ${err.message}`));
  }

  private toBuffer(data: RawData): Buffer {
    if (Buffer.isBuffer(data)) return data;
    if (Array.isArray(data)) return Buffer.concat(data);
    return Buffer.from(data as ArrayBuffer);
  }
}
