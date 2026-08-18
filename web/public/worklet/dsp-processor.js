// AudioWorklet processor that hosts the Rust/WASM DSP core.
//
// This file runs in the AudioWorkletGlobalScope: there is no `fetch`, no DOM and
// no module system. The main thread fetches the compiled wasm bytes and posts
// them here; we instantiate synchronously and process each 128-sample render
// quantum entirely on the audio thread (no per-frame round-trips to JS land).
//
// Ports:
//   input 0  -> microphone (mono)
//   input 1  -> optional far-end / loudspeaker reference for echo cancellation
//   output 0 -> processed audio

class DspProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ready = false;
    this.exports = null;
    this.frame = 128;
    this.statusEvery = 8; // post status roughly every ~21 ms
    this.tick = 0;

    this.port.onmessage = (event) => {
      const msg = event.data;
      if (msg.type === "init") {
        this.init(msg.wasm, msg.config);
      } else if (msg.type === "config") {
        if (this.ready) this.applyConfig(msg.config);
        else this.pendingConfig = msg.config;
      } else if (msg.type === "bypass") {
        if (this.ready) this.exports.dsp_set_bypass(msg.on ? 1 : 0);
        else this.pendingBypass = msg.on;
      }
    };
  }

  init(wasmBytes, config) {
    const module = new WebAssembly.Module(wasmBytes);
    const instance = new WebAssembly.Instance(module, {});
    this.exports = instance.exports;
    this.exports.dsp_init(sampleRate); // `sampleRate` is a worklet global
    this.frame = this.exports.dsp_frame_size();
    this.inPtr = this.exports.dsp_input_ptr();
    this.outPtr = this.exports.dsp_output_ptr();
    this.refPtr = this.exports.dsp_reference_ptr();
    this.ready = true;
    if (config) this.applyConfig(config);
    if (this.pendingConfig) {
      this.applyConfig(this.pendingConfig);
      this.pendingConfig = null;
    }
    if (this.pendingBypass !== undefined) {
      this.exports.dsp_set_bypass(this.pendingBypass ? 1 : 0);
      this.pendingBypass = undefined;
    }
    this.port.postMessage({ type: "ready", sampleRate, frame: this.frame });
  }

  applyConfig(c) {
    const e = this.exports;
    const b = (v) => (v ? 1 : 0);
    if (c.aec) e.dsp_set_aec(b(c.aec.on), c.aec.mu);
    if (c.ns) e.dsp_set_ns(b(c.ns.on), c.ns.strength);
    if (c.agc) e.dsp_set_agc(b(c.agc.on), c.agc.target);
    if (c.comp)
      e.dsp_set_compressor(b(c.comp.on), c.comp.threshold, c.comp.ratio, c.comp.makeup);
    if (c.vad) e.dsp_set_vad(b(c.vad.on), c.vad.sensitivity, b(c.vad.gate));
    if (c.fx) e.dsp_set_effects(b(c.fx.hp), b(c.fx.echo), c.fx.delay | 0, c.fx.fb, c.fx.mix);
  }

  process(inputs, outputs) {
    const output = outputs[0];
    if (!this.ready || output.length === 0) return true;

    const mic = inputs[0];
    const reference = inputs[1];
    const N = this.frame;
    const buf = this.exports.memory.buffer;

    // Microphone -> wasm input buffer.
    const inView = new Float32Array(buf, this.inPtr, N);
    if (mic && mic.length > 0 && mic[0].length === N) {
      inView.set(mic[0]);
    } else {
      inView.fill(0);
    }

    // Optional reference -> wasm reference buffer (for AEC).
    const refView = new Float32Array(buf, this.refPtr, N);
    if (reference && reference.length > 0 && reference[0].length === N) {
      refView.set(reference[0]);
    } else {
      refView.fill(0);
    }

    this.exports.dsp_process();

    // wasm output -> all output channels.
    const outView = new Float32Array(buf, this.outPtr, N);
    for (let ch = 0; ch < output.length; ch++) {
      output[ch].set(outView);
    }

    // DTMF is edge-triggered; drain it every quantum so nothing is missed.
    const key = this.exports.dsp_get_dtmf();
    if (key >= 0) this.port.postMessage({ type: "dtmf", key });

    if (++this.tick >= this.statusEvery) {
      this.tick = 0;
      this.port.postMessage({
        type: "status",
        vad: this.exports.dsp_get_vad() === 1,
        rms: this.exports.dsp_get_rms(),
        noiseFloor: this.exports.dsp_get_noise_floor(),
        gain: this.exports.dsp_get_gain(),
      });
    }

    return true;
  }
}

registerProcessor("dsp-processor", DspProcessor);
