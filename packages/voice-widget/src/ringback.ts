// Synthesized ringback ("tut… tut…") tone played locally in the widget while a
// call is connecting / ringing, so the visitor hears call progress instead of
// dead silence until the other side answers. It uses the Web Audio API — no
// audio asset to ship — gating a dual-tone oscillator with a double-ring cadence
// like a real ringback.

const RING_FREQS = [440, 480]; // dual-tone ringback (Hz) — the classic "ring" timbre
const LEVEL = 0.08; // gentle: ringback should sit comfortably below speech volume

// Double-ring cadence: ring, short gap, ring, long gap — repeated. Each `true`
// segment is an audible burst; `false` is silence. Durations are milliseconds.
const CADENCE: Array<[on: boolean, ms: number]> = [
  [true, 400],
  [false, 200],
  [true, 400],
  [false, 2000],
];

type AudioContextCtor = typeof AudioContext;

export class Ringback {
  private ctx?: AudioContext;
  private gain?: GainNode;
  private oscillators: OscillatorNode[] = [];
  private timer?: number;
  private playing = false;

  /**
   * Warm up (create + resume) the audio context from inside a user gesture —
   * the visitor's Call click — so a slightly-later {@link start} isn't blocked
   * by the browser's autoplay policy. Safe to call repeatedly.
   */
  prime(): void {
    const ctx = this.ensureCtx();
    if (ctx && ctx.state === "suspended") void ctx.resume();
  }

  /** Begin the looping ringback cadence. No-op if already playing or unsupported. */
  start(): void {
    if (this.playing) return;
    const ctx = this.ensureCtx();
    if (!ctx) return;
    if (ctx.state === "suspended") void ctx.resume();
    this.playing = true;
    this.runCadence(0);
  }

  /** Silence the ringback (keeps the context warm for a possible next call). */
  stop(): void {
    if (!this.playing) return;
    this.playing = false;
    if (this.timer !== undefined) {
      window.clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.setGain(0);
  }

  /** Tear everything down (stop oscillators, close the context). */
  destroy(): void {
    this.stop();
    this.oscillators.forEach((osc) => {
      try {
        osc.stop();
      } catch {
        /* already stopped */
      }
    });
    this.oscillators = [];
    try {
      void this.ctx?.close();
    } catch {
      /* noop */
    }
    this.ctx = undefined;
    this.gain = undefined;
  }

  private ensureCtx(): AudioContext | undefined {
    if (this.ctx) return this.ctx;
    if (typeof window === "undefined") return undefined;
    const AC: AudioContextCtor | undefined =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
    if (!AC) return undefined;

    const ctx = new AC();
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(ctx.destination);

    // Oscillators run continuously; the cadence is produced by gating the gain,
    // which avoids the cost/clicks of constantly creating and destroying nodes.
    RING_FREQS.forEach((freq) => {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;
      osc.connect(gain);
      osc.start();
      this.oscillators.push(osc);
    });

    this.ctx = ctx;
    this.gain = gain;
    return ctx;
  }

  private setGain(level: number): void {
    if (!this.ctx || !this.gain) return;
    const now = this.ctx.currentTime;
    // A short ramp instead of a hard set avoids an audible click at each edge.
    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.setTargetAtTime(level, now, 0.015);
  }

  private runCadence(index: number): void {
    if (!this.playing) return;
    const [on, ms] = CADENCE[index];
    this.setGain(on ? LEVEL : 0);
    const next = (index + 1) % CADENCE.length;
    this.timer = window.setTimeout(() => this.runCadence(next), ms);
  }
}
