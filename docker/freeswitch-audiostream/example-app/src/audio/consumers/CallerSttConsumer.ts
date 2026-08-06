import type { IAudioConsumer, AudioChunk, ILogger } from '@/core/interfaces';
import { extractCaller } from '@/audio/channels';

// Example STT/VAD consumer. It de-interleaves the CALLER channel (channel 0)
// from the stream so it never transcribes the AI's own voice — the key reason
// to keep the caller on its own channel. Swap the body of onAudio() for a real
// streaming STT client (Deepgram, Whisper, Vosk, ...).
export class CallerSttConsumer implements IAudioConsumer {
  readonly name = 'caller-stt';
  private readonly bytes = new Map<string, number>();

  constructor(private readonly logger: ILogger) {}

  onAudio(chunk: AudioChunk): void {
    // Caller-only PCM (LE 16-bit @ chunk.sampleRate). Feed this to your STT.
    const caller = extractCaller(chunk.pcm, chunk.channels);
    this.bytes.set(chunk.uuid, (this.bytes.get(chunk.uuid) ?? 0) + caller.length);
  }

  onClose(uuid: string): void {
    const total = this.bytes.get(uuid) ?? 0;
    this.logger.info(`caller audio delivered for ${uuid}: ${total} bytes`);
    this.bytes.delete(uuid);
  }
}
