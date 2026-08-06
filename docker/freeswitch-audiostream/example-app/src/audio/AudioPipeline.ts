import type { IAudioConsumer, AudioChunk, ILogger } from '@/core/interfaces';

// Fan-out for decoded call audio. Register consumers with use() (STT, VAD,
// analytics...) and the AudioStreamServer feeds every frame to all of them.
// Consumers are isolated so a failing one can't break the pipeline or recording.
export class AudioPipeline {
  private readonly consumers: IAudioConsumer[] = [];

  constructor(private readonly logger: ILogger) {}

  use(consumer: IAudioConsumer): this {
    this.consumers.push(consumer);
    this.logger.info(`registered audio consumer: ${consumer.name}`);
    return this;
  }

  get isEmpty(): boolean {
    return this.consumers.length === 0;
  }

  push(chunk: AudioChunk): void {
    for (const c of this.consumers) {
      try {
        c.onAudio(chunk);
      } catch (err) {
        this.logger.error(`consumer '${c.name}' onAudio failed: ${(err as Error).message}`);
      }
    }
  }

  close(uuid: string): void {
    for (const c of this.consumers) {
      try {
        c.onClose?.(uuid);
      } catch (err) {
        this.logger.error(`consumer '${c.name}' onClose failed: ${(err as Error).message}`);
      }
    }
  }
}
