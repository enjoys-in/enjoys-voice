import path from 'node:path';
import fs from 'node:fs';
import { FileWriter } from 'wav';
import type { IRecorder, IRecorderFactory, ILogger } from '@/core/interfaces';
import type { AppConfig } from '@/core/types';

// Project root = two levels up from this file (src/audio or dist/audio).
const PROJECT_ROOT = path.join(__dirname, '..', '..');

// Writes one call's PCM stream to a WAV file for debugging / QA.
class WavRecorder implements IRecorder {
  readonly filename: string | null;
  private readonly writer: FileWriter | null;

  constructor(uuid: string, config: AppConfig, logger: ILogger) {
    if (!config.recording.enabled) {
      this.filename = null;
      this.writer = null;
      return;
    }

    const dir = path.isAbsolute(config.recording.dir)
      ? config.recording.dir
      : path.join(PROJECT_ROOT, config.recording.dir);
    fs.mkdirSync(dir, { recursive: true });

    this.filename = `recording_${uuid}.wav`;
    this.writer = new FileWriter(path.join(dir, this.filename), {
      channels: config.audio.channels === 'mono' ? 1 : 2,
      sampleRate: config.audio.sampleRate,
      bitDepth: config.audio.bitDepth,
    });
    this.writer.on('error', (err: Error) => logger.error(`error (${uuid}): ${err.message}`));
  }

  write(pcm: Buffer): void {
    this.writer?.write(pcm);
  }

  close(): void {
    this.writer?.end();
  }
}

// Factory so the WS layer can create recorders without knowing the concrete type.
export class WavRecorderFactory implements IRecorderFactory {
  constructor(private readonly config: AppConfig, private readonly logger: ILogger) {}

  create(uuid: string): IRecorder {
    return new WavRecorder(uuid, this.config, this.logger);
  }
}
