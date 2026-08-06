import 'module-alias/register';

import config from '@/config';
import { ConsoleLogger } from '@/core/Logger';
import { CallRegistry } from '@/domain/CallRegistry';
import { L16Codec } from '@/audio/L16Codec';
import { WavRecorderFactory } from '@/audio/WavRecorderFactory';
import { AudioPipeline } from '@/audio/AudioPipeline';
import { CallerSttConsumer } from '@/audio/consumers/CallerSttConsumer';
import { EslTtsService } from '@/tts/EslTtsService';
import { CallController } from '@/application/CallController';
import { AudioStreamServer } from '@/transport/AudioStreamServer';
import { EslCallServer } from '@/transport/EslCallServer';
import { HttpServer } from '@/transport/HttpServer';
import type { IServer } from '@/core/interfaces';

// Composition root: the ONE place concrete implementations are wired together.
// Everything below depends only on interfaces, so swapping a logger, recorder,
// TTS engine, or transport is a one-line change here.
async function bootstrap(): Promise<void> {
  const logger = new ConsoleLogger();

  // Domain + capability services.
  const registry = new CallRegistry();
  const codec = new L16Codec(config.audio.swapEndianness);
  const recorderFactory = new WavRecorderFactory(config, logger.child('REC'));
  const tts = new EslTtsService(registry, config, logger.child('TTS'));
  const callController = new CallController(registry, tts, config, logger.child('CALL'));

  // Audio pipeline — plug in consumers (STT, VAD, analytics). Each consumer
  // de-interleaves the channel it needs; CallerSttConsumer uses caller-only.
  const audioPipeline = new AudioPipeline(logger.child('AUDIO'));
  audioPipeline.use(new CallerSttConsumer(logger.child('STT')));

  // Transport servers.
  const servers: IServer[] = [
    new HttpServer(config, tts, registry, logger.child('HTTP')),
    new AudioStreamServer(config, recorderFactory, codec, logger.child('WS'), audioPipeline),
    new EslCallServer(config, callController, logger.child('ESL')),
  ];

  for (const server of servers) await server.start();

  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`Received ${signal}, shutting down...`);
    for (const server of servers) await server.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

bootstrap().catch((err) => {
  console.error('[FATAL] Failed to start:', err);
  process.exit(1);
});
