/**
 * Web Audio helpers for the PSTN→browser bridge.
 *
 * The bridge exchanges raw PCM16LE mono at 8 kHz (the same format the streaming
 * server speaks after μ-law decode):
 *   - {@link BridgePlayer} schedules inbound caller audio back-to-back for
 *     gapless playback.
 *   - {@link MicCapture} captures the mic, downsamples to 8 kHz PCM16, and hands
 *     each frame to a callback to send over the WebSocket.
 *
 * Both are framework-agnostic (no React) so they can be driven by a hook and
 * unit-reasoned in isolation. Matches the reference page bridge-test.html.
 */

/** Sample rate of the bridge wire format (Twilio μ-law → PCM16 8 kHz). */
export const BRIDGE_SAMPLE_RATE = 8000;

/**
 * Plays inbound PCM16 8 kHz frames through an AudioContext, scheduling each
 * buffer immediately after the previous one so the stream has no gaps.
 *
 * AudioContext must be (re)started from a user gesture — call {@link resume}
 * from the "answer" click before feeding frames.
 */
export class BridgePlayer {
  private ctx: AudioContext | null = null;
  /** Absolute context time the next buffer should start at. */
  private playAt = 0;

  /** Lazily create + resume the context (call inside a user gesture). */
  async resume(): Promise<void> {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      this.ctx = new Ctor();
      this.playAt = 0;
    }
    if (this.ctx.state === "suspended") await this.ctx.resume();
  }

  /** Schedule one PCM16 frame for gapless playback. No-op until resumed. */
  play(int16: Int16Array): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const f32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) f32[i] = int16[i] / 32768;

    const buf = ctx.createBuffer(1, f32.length, BRIDGE_SAMPLE_RATE);
    buf.copyToChannel(f32, 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);

    const now = ctx.currentTime;
    // If we've fallen behind (underrun), restart slightly ahead to avoid glitches.
    if (this.playAt < now) this.playAt = now + 0.02;
    src.start(this.playAt);
    this.playAt += buf.duration;
  }

  /** Tear down the context and reset scheduling. */
  close(): void {
    this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.playAt = 0;
  }
}

/**
 * Captures the microphone and emits 8 kHz PCM16 frames via `onFrame`.
 *
 * Uses ScriptProcessorNode (deprecated but universally supported and matches the
 * reference test page); the captured mic is routed through a muted gain node so
 * the user never hears their own voice locally.
 */
export class MicCapture {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private proc: ScriptProcessorNode | null = null;
  private muted = false;

  /**
   * Request the mic and start emitting frames. Must be called from a user
   * gesture (browser permission + autoplay policy).
   * @throws if mic permission is denied / unavailable.
   */
  async start(onFrame: (frame: Int16Array) => void): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    this.ctx = new Ctor();
    if (this.ctx.state === "suspended") await this.ctx.resume();

    const src = this.ctx.createMediaStreamSource(this.stream);
    this.proc = this.ctx.createScriptProcessor(2048, 1, 1);
    const mute = this.ctx.createGain();
    mute.gain.value = 0; // don't echo our own mic to the local speakers
    src.connect(this.proc);
    this.proc.connect(mute);
    mute.connect(this.ctx.destination);

    const inRate = this.ctx.sampleRate;
    this.proc.onaudioprocess = (e) => {
      if (this.muted) return;
      const down = downsample(e.inputBuffer.getChannelData(0), inRate, BRIDGE_SAMPLE_RATE);
      onFrame(floatToInt16(down));
    };
  }

  /** Mute/unmute outbound mic (stops/resumes sending frames). */
  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  /** Stop the mic, processor and context. */
  stop(): void {
    if (this.proc) {
      this.proc.onaudioprocess = null;
      this.proc.disconnect();
      this.proc = null;
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.ctx?.close().catch(() => {});
    this.ctx = null;
  }
}

/** Average-decimate a Float32 buffer from `inRate` down to `outRate`. */
export function downsample(input: Float32Array, inRate: number, outRate: number): Float32Array {
  if (outRate >= inRate) return input;
  const ratio = inRate / outRate;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.floor((i + 1) * ratio);
    let sum = 0;
    let n = 0;
    for (let j = start; j < end && j < input.length; j++) {
      sum += input[j];
      n++;
    }
    out[i] = n ? sum / n : 0;
  }
  return out;
}

/** Convert a clamped Float32 [-1,1] buffer to signed PCM16. */
export function floatToInt16(f32: Float32Array): Int16Array {
  const out = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]));
    out[i] = s < 0 ? s * 32768 : s * 32767;
  }
  return out;
}
