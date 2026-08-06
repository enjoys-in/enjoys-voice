import type { ICallRegistry, ITtsService, ILogger } from '@/core/interfaces';
import type { AppConfig, EslConnection } from '@/core/types';

// Orchestrates a single call's lifecycle once FreeSWITCH connects its Outbound
// ESL socket. This is the only place that knows the call *flow* (answer -> fork
// caller audio to our WS -> greet), keeping transport (EslCallServer) and
// capabilities (registry, TTS) as swappable collaborators.
export class CallController {
  constructor(
    private readonly registry: ICallRegistry,
    private readonly tts: ITtsService,
    private readonly config: AppConfig,
    private readonly logger: ILogger
  ) {}

  handleConnection(conn: EslConnection): void {
    const uuid = conn.getInfo().getHeader('Channel-Call-UUID') ?? 'unknown';
    this.logger.info(`New call! UUID: ${uuid}`);

    this.registry.set(uuid, conn);
    conn.on('error', (err) => this.logger.error(`Connection error for ${uuid}:`, err));
    conn.on('esl::end', () => {
      this.logger.info(`Call ended (${uuid})`);
      this.registry.delete(uuid);
    });

    conn.execute('answer', '', () => this.onAnswered(uuid, conn));
  }

  private onAnswered(uuid: string, conn: EslConnection): void {
    this.logger.info(`Answered ${uuid}. Starting caller-audio stream...`);

    // Fork call audio out to our WebSocket receiver on the Docker network. The
    // mix mode is configurable: stereo = caller (left) + callee/AI (right),
    // mixed = both in one channel, mono = caller only.
    const { ws, audio } = this.config;
    const wsUrl = `ws://${ws.hostForFreeswitch}:${ws.port}/${uuid}`;
    const cmd = `uuid_audio_stream ${uuid} start ${wsUrl} ${audio.channels} ${audio.sampleRate} {"callId":"${uuid}"}`;

    conn.api(cmd, (res) => {
      this.logger.info(`audio_stream: ${res.getBody().trim()}`);
      // Greeting is the full-duplex "back" leg, delivered over ESL.
      conn.execute('playback', 'tone_stream://%(350,0,440)', () => {
        this.tts.speak(uuid, this.config.tts.greeting);
      });
    });
  }
}
