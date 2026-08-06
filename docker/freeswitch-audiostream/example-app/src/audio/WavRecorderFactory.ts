import path from 'node:path';
import fs from 'node:fs';
import { FileWriter } from 'wav';
import type { IRecorder, IRecorderFactory, ILogger } from '@/core/interfaces';
import type { AppConfig } from '@/core/types';

// Project root = two levels up from this file (src/audio or dist/audio).
const PROJECT_ROOT = path.join(__dirname, '..', '..');

// Averages interleaved stereo L16 (LE) into a single centered mono channel.
function downmixStereoToMono(stereo: Buffer): Buffer {
  const frames = Math.floor(stereo.length / 4); // 2 channels * 2 bytes
  const mono = Buffer.allocUnsafe(frames * 2);
  for (let i = 0; i < frames; i++) {
    const l = stereo.readInt16LE(i * 4);
    const r = stereo.readInt16LE(i * 4 + 2);
    mono.writeInt16LE((l + r) >> 1, i * 2);
  }
  return mono;
}

// Writes one call's PCM stream to a WAV file for debugging / QA.
class WavRecorder implements IRecorder {
  readonly filename: string | null;
  private readonly writer: FileWriter | null;
  private readonly downmix: boolean;

  constructor(uuid: string, config: AppConfig, logger: ILogger) {
    this.downmix = config.audio.channels === 'stereo' && config.recording.downmix;
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
      // 'stereo' is 2 interleaved channels unless we downmix; 'mono'/'mixed' are
      // single-channel (a 2-ch header there would garble playback speed).
      channels: config.audio.channels === 'stereo' && !this.downmix ? 2 : 1,
      sampleRate: config.audio.sampleRate,
      bitDepth: config.audio.bitDepth,
    });
    this.writer.on('error', (err: Error) => logger.error(`error (${uuid}): ${err.message}`));
  }

  write(pcm: Buffer): void {
    this.writer?.write(this.downmix ? downmixStereoToMono(pcm) : pcm);
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
