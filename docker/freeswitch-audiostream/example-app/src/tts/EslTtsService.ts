import type { ITtsService, ICallRegistry, ILogger } from '@/core/interfaces';
import type { AppConfig } from '@/core/types';

// The "return" half of full-duplex: pushes synthesized speech back into a live
// call over ESL (Piper via mod_tts_commandline). The STT/AI layer calls speak()
// once it has a reply.
export class EslTtsService implements ITtsService {
  constructor(
    private readonly registry: ICallRegistry,
    private readonly config: AppConfig,
    private readonly logger: ILogger
  ) {}

  speak(uuid: string, text: string, voice: string = this.config.tts.voice): boolean {
    const conn = this.registry.get(uuid);
    if (!conn) {
      this.logger.warn(`No active call for UUID ${uuid}`);
      return false;
    }
    this.logger.info(`Speaking into ${uuid}: "${text}"`);
    conn.execute('speak', `tts_commandline|${voice}|${text}`);
    return true;
  }
}
