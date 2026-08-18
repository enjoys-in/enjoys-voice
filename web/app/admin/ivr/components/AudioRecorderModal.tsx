/**
 * Audio recorder modal — capture an IVR prompt from the mic with a live
 * waveform, playback preview, and full VoxFront voice-cleaning control.
 *
 * Cleaning runs through the VoxFront WASM DSP core (voip_dsp.wasm) inside an
 * AudioWorklet, exposing every stage it supports: echo cancellation, noise
 * suppression (with strength), auto gain, compressor, a voice gate and a
 * high-pass rumble cut — each individually togglable, plus environment presets.
 * With the DSP engine the processed stream is recorded directly, so cleanup can
 * be tuned LIVE while recording.
 *
 * When voip_dsp.wasm isn't present the modal falls back to the browser's native
 * capture constraints (echo cancellation / noise suppression / auto gain), which
 * are fixed at capture time; DSP-only controls are disabled in that mode.
 *
 * The browser's MediaRecorder emits webm/ogg/mp4 (never raw WAV); the Go upload
 * endpoint accepts those and transcodes to the FreeSWITCH-canonical 16 kHz mono
 * WAV server-side, so a recording still lands as .wav.
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Mic,
  Square,
  Play,
  Pause,
  RotateCcw,
  Loader2,
  Check,
  Sparkles,
} from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { AudioEngine } from "@/lib/voxfront/AudioEngine";
import { presets, type DspConfig } from "@/lib/voxfront/config";

const MAX_RECORD_SECS = 60; // ~180KB at 24 kbps, safely under the 250KB cap
const MAX_UPLOAD_BYTES = 250 * 1024;
const WAVE_BUCKETS = 96;
const WASM_URL = "/voip_dsp.wasm";

/**
 * Starting profile for one-way prompt capture: noise-suppress + high-pass only.
 * AGC and the compressor are OFF by default — the WASM AGC rides up to ~30 dB
 * and pumps/clips quiet mics ("breaking" audio) — but stay available as toggles.
 */
const INITIAL_CONFIG: DspConfig = {
  aec: { on: false, mu: 0.3 },
  ns: { on: true, strength: 0.8 },
  agc: { on: false, target: 0.12 },
  comp: { on: false, threshold: 0.3, ratio: 3.0, makeup: 1.2 },
  vad: { on: true, sensitivity: 0.5, gate: false },
  fx: { hp: true, echo: false, delay: 9600, fb: 0.3, mix: 0.4 },
};

export const recorderSupported =
  typeof navigator !== "undefined" &&
  !!navigator.mediaDevices?.getUserMedia &&
  typeof MediaRecorder !== "undefined";

type Phase = "idle" | "recording" | "recorded";

function pickRecordingMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/ogg",
    "audio/mp4",
  ].find((t) => MediaRecorder.isTypeSupported(t));
}

function formatSecs(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Fit the canvas backing store to its CSS box at device pixel ratio. */
function sizeCanvas(
  canvas: HTMLCanvasElement,
): { ctx: CanvasRenderingContext2D; w: number; h: number } | null {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = rect.width;
  const h = rect.height;
  const bw = Math.max(1, Math.round(w * dpr));
  const bh = Math.max(1, Math.round(h * dpr));
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

/** Reduce decoded PCM to a normalized 0..1 peak per bucket for the bar view. */
function computePeaks(buf: AudioBuffer, buckets = WAVE_BUCKETS): Float32Array {
  const data = buf.getChannelData(0);
  const block = Math.floor(data.length / buckets) || 1;
  const peaks = new Float32Array(buckets);
  let max = 0;
  for (let b = 0; b < buckets; b++) {
    let localMax = 0;
    const start = b * block;
    for (let i = 0; i < block; i++) {
      const v = Math.abs(data[start + i] || 0);
      if (v > localMax) localMax = v;
    }
    peaks[b] = localMax;
    if (localMax > max) max = localMax;
  }
  if (max > 0) for (let i = 0; i < peaks.length; i++) peaks[i] /= max;
  return peaks;
}

/** True when the current config exactly matches a named VoxFront preset. */
function matchPreset(cfg: DspConfig): string {
  const target = JSON.stringify(cfg);
  for (const [key, p] of Object.entries(presets)) {
    if (JSON.stringify(p.config) === target) return key;
  }
  return "custom";
}

export function AudioRecorderModal({
  open,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Upload the recorded file; resolve true on success so the modal can close. */
  onSave: (file: File) => Promise<boolean>;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // null = still probing for the DSP wasm; true = VoxFront DSP; false = native.
  const [dspReady, setDspReady] = useState<boolean | null>(null);
  const dspMode = dspReady === true;

  // Master voice-cleaning switch + the full VoxFront DSP config.
  const [clean, setClean] = useState(true);
  const [cfg, setCfg] = useState<DspConfig>(() => structuredClone(INITIAL_CONFIG));

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const liveBufRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const engineRef = useRef<AudioEngine | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const blobRef = useRef<Blob | null>(null);
  const urlRef = useRef<string | null>(null);
  const peaksRef = useRef<Float32Array | null>(null);
  const timerRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  const waveColor = () => {
    const c = canvasRef.current;
    return c ? getComputedStyle(c).color : "rgb(59,130,246)";
  };

  const drawLive = useCallback(() => {
    const canvas = canvasRef.current;
    const analyser = analyserRef.current;
    const buf = liveBufRef.current;
    if (!canvas || !analyser || !buf) return;
    const sized = sizeCanvas(canvas);
    if (!sized) return;
    const { ctx, w, h } = sized;
    analyser.getByteTimeDomainData(buf);
    ctx.clearRect(0, 0, w, h);
    ctx.lineWidth = 2;
    ctx.strokeStyle = waveColor();
    ctx.beginPath();
    const slice = w / buf.length;
    for (let i = 0; i < buf.length; i++) {
      const v = buf[i] / 128 - 1; // -1..1
      const y = h / 2 + v * (h / 2) * 0.9;
      const x = i * slice;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    rafRef.current = requestAnimationFrame(drawLive);
  }, []);

  const drawStatic = useCallback((progress = 0) => {
    const canvas = canvasRef.current;
    const peaks = peaksRef.current;
    if (!canvas) return;
    const sized = sizeCanvas(canvas);
    if (!sized) return;
    const { ctx, w, h } = sized;
    ctx.clearRect(0, 0, w, h);
    if (!peaks) return;
    const color = waveColor();
    const n = peaks.length;
    const barW = w / n;
    for (let i = 0; i < n; i++) {
      const barH = Math.max(2, peaks[i] * h * 0.9);
      const x = i * barW;
      const y = (h - barH) / 2;
      ctx.globalAlpha = i / n <= progress ? 1 : 0.3;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, Math.max(1, barW - 1), barH);
    }
    ctx.globalAlpha = 1;
  }, []);

  const clearRecorded = useCallback(() => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    blobRef.current = null;
    peaksRef.current = null;
    setRecordedUrl(null);
    setPlaying(false);
    setElapsed(0);
  }, []);

  /** Release the mic, DSP engine and any analyser context. */
  const releaseCapture = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    void engineRef.current?.stop().catch(() => {});
    engineRef.current = null;
    analyserRef.current = null;
  }, []);

  const teardown = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") {
      try {
        rec.stop();
      } catch {
        /* already stopped */
      }
    }
    recorderRef.current = null;
    releaseCapture();
    clearRecorded();
    setPhase("idle");
    setError(null);
    setSaving(false);
  }, [clearRecorded, releaseCapture]);

  // Release the mic / audio graph whenever the modal is closed or unmounts.
  useEffect(() => {
    if (!open) teardown();
    return () => teardown();
  }, [open, teardown]);

  // Probe for the VoxFront DSP wasm each time the modal opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setDspReady(null);
    fetch(WASM_URL, { method: "HEAD" })
      .then((r) => {
        if (!cancelled) setDspReady(r.ok);
      })
      .catch(() => {
        if (!cancelled) setDspReady(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Push live config changes to a running DSP engine (DSP mode only).
  useEffect(() => {
    if (engineRef.current) engineRef.current.setConfig(cfg);
  }, [cfg]);

  useEffect(() => {
    if (engineRef.current) engineRef.current.setBypass(!clean);
  }, [clean]);

  // (Re)draw the static waveform once a recording is ready.
  useEffect(() => {
    if (phase === "recorded") {
      const id = requestAnimationFrame(() => drawStatic(0));
      return () => cancelAnimationFrame(id);
    }
  }, [phase, recordedUrl, drawStatic]);

  const finalizeStopped = useCallback(
    async (type: string) => {
      const blob = new Blob(chunksRef.current, { type });
      blobRef.current = blob;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      setRecordedUrl(url);
      setPhase("recorded");

      // Release mic + DSP engine now that capture is done.
      releaseCapture();

      // Decode to peaks for the static waveform (best-effort).
      try {
        const AC =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext;
        const actx = new AC();
        const audioBuf = await actx.decodeAudioData(await blob.arrayBuffer());
        peaksRef.current = computePeaks(audioBuf);
        await actx.close();
      } catch {
        peaksRef.current = null;
      }
      requestAnimationFrame(() => drawStatic(0));
    },
    [drawStatic, releaseCapture],
  );

  const stopRecording = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") rec.stop(); // → onstop → finalizeStopped
  }, []);

  /** Wire a MediaRecorder + timer + live waveform onto a capture stream. */
  const beginCapture = useCallback(
    (stream: MediaStream, analyser: AnalyserNode) => {
      analyserRef.current = analyser;
      liveBufRef.current = new Uint8Array(analyser.fftSize);

      const mimeType = pickRecordingMime();
      const rec = new MediaRecorder(
        stream,
        mimeType ? { mimeType, audioBitsPerSecond: 24000 } : undefined,
      );
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () =>
        void finalizeStopped(rec.mimeType || mimeType || "audio/webm");
      recorderRef.current = rec;
      rec.start();

      setPhase("recording");
      setElapsed(0);
      let secs = 0;
      timerRef.current = window.setInterval(() => {
        secs += 1;
        setElapsed(secs);
        if (secs >= MAX_RECORD_SECS) stopRecording();
      }, 1000);
      rafRef.current = requestAnimationFrame(drawLive);
    },
    [drawLive, finalizeStopped, stopRecording],
  );

  const startRecording = useCallback(async () => {
    setError(null);
    clearRecorded();
    try {
      if (dspMode) {
        // ── VoxFront DSP path: record the processed stream directly ──
        let readyResolve: (() => void) | null = null;
        const ready = new Promise<void>((res) => {
          readyResolve = res;
        });
        const engine = new AudioEngine({
          onReady: () => readyResolve?.(),
          onState: (state, detail) => {
            if (state === "error") setError(detail ?? "DSP engine failed.");
          },
        });
        engineRef.current = engine;
        engine.setConfig(cfg);
        engine.setBypass(!clean);
        await engine.start();
        // Wait for the worklet to instantiate the wasm so we don't capture a
        // leading blip of silence (cap the wait so a stuck init can't hang).
        await Promise.race([
          ready,
          new Promise<void>((res) => window.setTimeout(res, 1500)),
        ]);

        const stream = engine.processedStream;
        const analyser = engine.processedAnalyser;
        if (!stream || !analyser) throw new Error("DSP stream unavailable.");
        beginCapture(stream, analyser);
      } else {
        // ── Native fallback: browser capture constraints (fixed at capture) ──
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: clean && cfg.aec.on,
            noiseSuppression: clean && cfg.ns.on,
            autoGainControl: clean && cfg.agc.on,
            channelCount: 1,
          },
          video: false,
        });
        streamRef.current = stream;

        // Live analyser only — never connected to destination, so no monitor
        // feedback loop while recording.
        const AC =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext;
        const actx = new AC();
        audioCtxRef.current = actx;
        const source = actx.createMediaStreamSource(stream);
        const analyser = actx.createAnalyser();
        analyser.fftSize = 1024;
        source.connect(analyser);
        beginCapture(stream, analyser);
      }
    } catch (err) {
      releaseCapture();
      setError(
        err instanceof Error && err.message
          ? err.message
          : "Microphone unavailable or permission denied.",
      );
      setPhase("idle");
    }
  }, [dspMode, cfg, clean, clearRecorded, beginCapture, releaseCapture]);

  const togglePlay = () => {
    const el = audioElRef.current;
    if (!el) return;
    if (el.paused) void el.play();
    else el.pause();
  };

  const handleSave = async () => {
    const blob = blobRef.current;
    if (!blob) return;
    const container = blob.type.includes("ogg")
      ? "ogg"
      : blob.type.includes("mp4")
        ? "m4a"
        : "webm";
    const file = new File([blob], `recording-${Date.now()}.${container}`, {
      type: blob.type,
    });
    if (file.size > MAX_UPLOAD_BYTES) {
      setError("Recording too large (max 250KB). Record a shorter clip.");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const ok = await onSave(file);
      if (ok) onOpenChange(false);
      else setError("Upload failed. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  // ── config helpers ──
  const setStage = useCallback(
    <K extends keyof DspConfig>(k: K, patch: Partial<DspConfig[K]>) =>
      setCfg((c) => ({ ...c, [k]: { ...c[k], ...patch } })),
    [],
  );

  const applyPreset = useCallback((key: string) => {
    const p = presets[key];
    if (p) setCfg(structuredClone(p.config));
  }, []);

  const presetValue = matchPreset(cfg);

  // Native capture constraints are fixed once recording starts.
  const nativeLocked = !dspMode && phase === "recording";
  const masterDisabled = saving || nativeLocked || dspReady === null;
  const stageDisabled = masterDisabled || !clean;
  const dspOnlyDisabled = stageDisabled || !dspMode;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mic className="h-4 w-4 text-primary" />
            Record prompt
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            {dspMode
              ? "VoxFront cleans your voice in real time — tune it live while recording, then preview and save."
              : "Record from your microphone, preview it, then save."}
          </p>
        </DialogHeader>

        {!recorderSupported ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Recording isn’t supported in this browser.
          </p>
        ) : (
          <div className="space-y-3">
            {/* Waveform */}
            <div className="relative rounded-lg border border-border/60 bg-muted/30 p-2">
              <canvas ref={canvasRef} className="h-24 w-full text-primary" />
              {phase === "idle" && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
                  Waveform appears here while recording
                </div>
              )}
              {phase === "recording" && (
                <div className="absolute right-2 top-2 flex items-center gap-1.5 rounded-full bg-destructive/10 px-2 py-0.5">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-destructive" />
                  <span className="text-[11px] tabular-nums text-destructive">
                    {formatSecs(elapsed)} / {formatSecs(MAX_RECORD_SECS)}
                  </span>
                </div>
              )}
            </div>

            {/* Voice cleaning controls */}
            <div className="space-y-2.5 rounded-lg border border-border/60 p-3">
              {/* Master toggle + engine badge */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                  <Label className="text-xs font-medium">Clean voice</Label>
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide",
                      dspMode
                        ? "bg-primary/10 text-primary"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {dspReady === null
                      ? "…"
                      : dspMode
                        ? "VoxFront DSP"
                        : "Browser"}
                  </span>
                </div>
                <Switch
                  checked={clean}
                  onCheckedChange={setClean}
                  disabled={masterDisabled}
                />
              </div>

              {/* Environment preset */}
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs text-muted-foreground">Preset</Label>
                <Select
                  value={presetValue}
                  onValueChange={(v) => v && applyPreset(v)}
                  disabled={stageDisabled}
                >
                  <SelectTrigger size="sm" className="h-7 w-44 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {Object.entries(presets).map(([key, p]) => (
                      <SelectItem key={key} value={key} className="text-xs">
                        {p.label}
                      </SelectItem>
                    ))}
                    {presetValue === "custom" && (
                      <SelectItem value="custom" className="text-xs">
                        Custom
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>

              <div className="h-px bg-border/60" />

              {/* Per-stage controls */}
              <ToggleRow
                label="Suppress background noise"
                checked={cfg.ns.on}
                onCheckedChange={(on) => setStage("ns", { on })}
                disabled={stageDisabled}
              />
              {dspMode && cfg.ns.on && (
                <div
                  className={cn(
                    "flex items-center gap-2 pl-1",
                    stageDisabled && "opacity-60",
                  )}
                >
                  <span className="text-[11px] text-muted-foreground">
                    Strength
                  </span>
                  <input
                    type="range"
                    min={0.4}
                    max={2}
                    step={0.1}
                    value={cfg.ns.strength}
                    onChange={(e) =>
                      setStage("ns", { strength: Number(e.target.value) })
                    }
                    disabled={stageDisabled}
                    className="h-1 flex-1 accent-primary"
                  />
                  <span className="w-8 text-right text-[11px] tabular-nums text-muted-foreground">
                    {cfg.ns.strength.toFixed(1)}×
                  </span>
                </div>
              )}
              <ToggleRow
                label="Echo cancellation"
                checked={cfg.aec.on}
                onCheckedChange={(on) => setStage("aec", { on })}
                disabled={stageDisabled}
              />
              <ToggleRow
                label="Auto-normalize volume"
                checked={cfg.agc.on}
                onCheckedChange={(on) => setStage("agc", { on })}
                disabled={stageDisabled}
              />
              <ToggleRow
                label="Compressor (even loudness)"
                checked={cfg.comp.on}
                onCheckedChange={(on) => setStage("comp", { on })}
                disabled={dspOnlyDisabled}
                dspOnly={!dspMode}
              />
              <ToggleRow
                label="Voice gate (mute silence)"
                checked={cfg.vad.gate}
                onCheckedChange={(gate) => setStage("vad", { gate })}
                disabled={dspOnlyDisabled}
                dspOnly={!dspMode}
              />
              <ToggleRow
                label="High-pass (cut rumble)"
                checked={cfg.fx.hp}
                onCheckedChange={(hp) => setStage("fx", { hp })}
                disabled={dspOnlyDisabled}
                dspOnly={!dspMode}
              />

              {!dspMode && dspReady === false && (
                <p className="text-[11px] text-muted-foreground/80">
                  VoxFront DSP unavailable — using the browser’s built-in cleanup.
                  Extra stages need <code>voip_dsp.wasm</code> in{" "}
                  <code>web/public/</code>.
                </p>
              )}
            </div>

            {/* Transport controls */}
            <div className="flex items-center gap-2">
              {phase === "recording" ? (
                <Button
                  type="button"
                  variant="destructive"
                  className="flex-1"
                  onClick={stopRecording}
                >
                  <Square className="mr-1.5 h-4 w-4" /> Stop
                </Button>
              ) : phase === "recorded" ? (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={togglePlay}
                    title={playing ? "Pause" : "Play"}
                  >
                    {playing ? (
                      <Pause className="h-4 w-4" />
                    ) : (
                      <Play className="h-4 w-4" />
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1"
                    onClick={startRecording}
                    disabled={saving}
                  >
                    <RotateCcw className="mr-1.5 h-4 w-4" /> Re-record
                  </Button>
                  <Button
                    type="button"
                    className="flex-1"
                    onClick={handleSave}
                    disabled={saving}
                  >
                    {saving ? (
                      <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    ) : (
                      <Check className="mr-1.5 h-4 w-4" />
                    )}
                    {saving ? "Saving…" : "Save"}
                  </Button>
                </>
              ) : (
                <Button
                  type="button"
                  className="flex-1"
                  onClick={startRecording}
                  disabled={dspReady === null}
                >
                  <Mic className="mr-1.5 h-4 w-4" />
                  {dspReady === null ? "Preparing…" : "Start recording"}
                </Button>
              )}
            </div>

            {error && <p className="text-[11px] text-destructive">{error}</p>}
            <p className="text-[11px] text-muted-foreground/70">
              Max {MAX_RECORD_SECS}s. Saved as a normalized WAV for FreeSWITCH.
            </p>

            {/* Hidden element drives playback + the waveform playhead. */}
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <audio
              ref={audioElRef}
              src={recordedUrl ?? undefined}
              className="hidden"
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={() => {
                setPlaying(false);
                drawStatic(0);
              }}
              onTimeUpdate={(e) => {
                const el = e.currentTarget;
                if (el.duration) drawStatic(el.currentTime / el.duration);
              }}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ToggleRow({
  label,
  checked,
  onCheckedChange,
  disabled,
  dspOnly,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  disabled?: boolean;
  dspOnly?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-2",
        disabled && "opacity-60",
      )}
    >
      <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {label}
        {dspOnly && (
          <span className="rounded bg-muted px-1 py-0.5 text-[9px] uppercase tracking-wide text-muted-foreground/70">
            DSP
          </span>
        )}
      </Label>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
      />
    </div>
  );
}
