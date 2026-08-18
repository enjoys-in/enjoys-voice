import type { DspConfig, DspConfigPatch, DspStatus, ListenMode } from "./config";
import { defaultConfig } from "./config";

const WASM_URL = "/voip_dsp.wasm";
const WORKLET_URL = "/worklet/dsp-processor.js";

export interface AudioEngineCallbacks {
  onReady?: () => void;
  onStatus?: (status: DspStatus) => void;
  onDtmf?: (key: number) => void;
  onState?: (state: "idle" | "running" | "error", detail?: string) => void;
}

function mergeConfig(base: DspConfig, patch: DspConfigPatch): DspConfig {
  const out = structuredClone(base);
  for (const k of Object.keys(patch) as (keyof DspConfig)[]) {
    Object.assign(out[k], patch[k]);
  }
  return out;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private micStream: MediaStream | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private rawGain: GainNode | null = null;
  private procGain: GainNode | null = null;
  private rawAnalyserNode: AnalyserNode | null = null;
  private procAnalyserNode: AnalyserNode | null = null;
  private limiter: DynamicsCompressorNode | null = null;
  private streamDest: MediaStreamAudioDestinationNode | null = null;
  private referenceNode: AudioNode | null = null;
  private farOsc: OscillatorNode | null = null;
  private farGain: GainNode | null = null;
  private config: DspConfig = structuredClone(defaultConfig);
  private listenMode: ListenMode = "off";
  private bypass = false;

  constructor(private readonly cb: AudioEngineCallbacks = {}) {}

  get isRunning(): boolean {
    return this.node !== null;
  }

  /** Processed audio as a MediaStream — attach this to a WebRTC/SIP sender. */
  get processedStream(): MediaStream | null {
    return this.streamDest?.stream ?? null;
  }

  get context(): AudioContext | null {
    return this.ctx;
  }

  get rawAnalyser(): AnalyserNode | null {
    return this.rawAnalyserNode;
  }

  get processedAnalyser(): AnalyserNode | null {
    return this.procAnalyserNode;
  }

  async start(): Promise<void> {
    if (this.node) return;
    try {
      const ctx = new AudioContext({ latencyHint: "interactive" });
      this.ctx = ctx;
      if (ctx.state === "suspended") await ctx.resume();

      // Raw microphone: disable the browser's own EC/NS/AGC so our WASM DSP is
      // the single source of truth.
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1,
        },
        video: false,
      });

      await ctx.audioWorklet.addModule(WORKLET_URL);

      const res = await fetch(WASM_URL);
      if (!res.ok) {
        throw new Error(
          `Failed to load ${WASM_URL} (${res.status}). Ensure voip_dsp.wasm is present in web/public/.`,
        );
      }
      const wasmBytes = await res.arrayBuffer();

      const node = new AudioWorkletNode(ctx, "dsp-processor", {
        numberOfInputs: 2,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        channelCountMode: "explicit",
        channelInterpretation: "speakers",
      });
      this.node = node;
      node.port.onmessage = (event) => this.onWorkletMessage(event.data);
      node.port.postMessage({ type: "init", wasm: wasmBytes, config: this.config }, [wasmBytes]);
      node.port.postMessage({ type: "bypass", on: this.bypass });

      // mic -> worklet input 0
      this.micSource = ctx.createMediaStreamSource(this.micStream);
      this.micSource.connect(node, 0, 0);

      // Brick-wall safety limiter on the PROCESSED path: the WASM core's AGC
      // rides up to ~30 dB with no output limiter, so aggressive gain/compressor
      // makeup can overshoot past 0 dBFS and hard-clip the recording ("breaking"
      // audio). This tames peaks near full scale and is transparent below it.
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -1;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.1;
      this.limiter = limiter;
      node.connect(limiter);

      // Analyser taps for the A/B visualizer (processed tapped post-limiter so
      // the meter matches what is recorded).
      this.rawAnalyserNode = this.makeAnalyser(ctx);
      this.procAnalyserNode = this.makeAnalyser(ctx);
      this.micSource.connect(this.rawAnalyserNode);
      limiter.connect(this.procAnalyserNode);

      // optional far-end reference -> worklet input 1
      if (this.referenceNode) this.referenceNode.connect(node, 0, 1);

      // worklet -> limiter -> processed MediaStream (always pulls the graph so
      // processing runs even when the monitor is muted).
      this.streamDest = ctx.createMediaStreamDestination();
      limiter.connect(this.streamDest);

      // A/B monitor gains -> speakers.
      this.rawGain = ctx.createGain();
      this.procGain = ctx.createGain();
      this.rawGain.gain.value = 0;
      this.procGain.gain.value = 0;
      this.micSource.connect(this.rawGain).connect(ctx.destination);
      limiter.connect(this.procGain).connect(ctx.destination);
      this.applyListenMode();

      this.cb.onState?.("running");
    } catch (err) {
      this.cb.onState?.("error", err instanceof Error ? err.message : String(err));
      await this.stop();
      throw err;
    }
  }

  private makeAnalyser(ctx: AudioContext): AnalyserNode {
    const a = ctx.createAnalyser();
    a.fftSize = 1024;
    a.smoothingTimeConstant = 0.4;
    return a;
  }

  /**
   * Toggle a 440 Hz far-end test tone routed to BOTH the speakers (so the mic
   * picks up real echo) and the AEC reference input. Returns the new on/off
   * state. Useful for demonstrating echo cancellation without a remote party.
   */
  toggleFarEndTone(): boolean {
    if (!this.ctx || !this.node) return false;
    if (this.farOsc) {
      this.farOsc.stop();
      this.farOsc.disconnect();
      this.farGain?.disconnect();
      this.farOsc = null;
      this.farGain = null;
      return false;
    }
    const osc = this.ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = 440;
    const gain = this.ctx.createGain();
    gain.gain.value = 0.25;
    osc.connect(gain);
    gain.connect(this.node, 0, 1); // -> AEC reference (worklet input 1)
    gain.connect(this.ctx.destination); // -> speakers (produces the echo)
    osc.start();
    this.farOsc = osc;
    this.farGain = gain;
    return true;
  }

  async stop(): Promise<void> {
    if (this.farOsc) {
      try {
        this.farOsc.stop();
      } catch {
        /* already stopped */
      }
      this.farOsc = null;
    }
    this.farGain?.disconnect();
    this.farGain = null;
    this.node?.disconnect();
    this.micSource?.disconnect();
    this.limiter?.disconnect();
    this.rawGain?.disconnect();
    this.procGain?.disconnect();
    this.rawAnalyserNode?.disconnect();
    this.procAnalyserNode?.disconnect();
    this.streamDest?.disconnect();
    this.referenceNode?.disconnect();
    this.micStream?.getTracks().forEach((t) => t.stop());
    if (this.ctx && this.ctx.state !== "closed") await this.ctx.close();

    this.node = null;
    this.micSource = null;
    this.limiter = null;
    this.rawGain = null;
    this.procGain = null;
    this.rawAnalyserNode = null;
    this.procAnalyserNode = null;
    this.streamDest = null;
    this.micStream = null;
    this.ctx = null;
    this.cb.onState?.("idle");
  }

  /** Apply a partial config change. Always pushes the FULL merged config to the
   * worklet so partial patches never zero out untouched fields. */
  updateConfig(patch: DspConfigPatch): void {
    this.config = mergeConfig(this.config, patch);
    this.node?.port.postMessage({ type: "config", config: this.config });
  }

  /** Replace the whole config (e.g. when applying a preset). */
  setConfig(config: DspConfig): void {
    this.config = structuredClone(config);
    this.node?.port.postMessage({ type: "config", config: this.config });
  }

  getConfig(): DspConfig {
    return structuredClone(this.config);
  }

  setListenMode(mode: ListenMode): void {
    this.listenMode = mode;
    this.applyListenMode();
  }

  getListenMode(): ListenMode {
    return this.listenMode;
  }

  private applyListenMode(): void {
    if (!this.rawGain || !this.procGain) return;
    this.rawGain.gain.value = this.listenMode === "raw" ? 1 : 0;
    this.procGain.gain.value = this.listenMode === "processed" ? 1 : 0;
  }

  /** Master bypass: when on, the worklet emits raw mic untouched (affects the
   * processed monitor AND the outgoing stream). */
  setBypass(on: boolean): void {
    this.bypass = on;
    this.node?.port.postMessage({ type: "bypass", on });
  }

  getBypass(): boolean {
    return this.bypass;
  }

  /**
   * Provide a far-end / loudspeaker signal for echo cancellation. Call before
   * {@link start}; the node is connected to the worklet's second input.
   */
  setReferenceNode(node: AudioNode | null): void {
    this.referenceNode = node;
  }

  private onWorkletMessage(msg: unknown): void {
    const m = msg as { type: string; [k: string]: unknown };
    switch (m.type) {
      case "ready":
        this.cb.onReady?.();
        break;
      case "status":
        this.cb.onStatus?.({
          vad: m.vad as boolean,
          rms: m.rms as number,
          noiseFloor: m.noiseFloor as number,
          gain: m.gain as number,
        });
        break;
      case "dtmf":
        this.cb.onDtmf?.(m.key as number);
        break;
    }
  }
}
