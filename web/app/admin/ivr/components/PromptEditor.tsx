/**
 * Prompt editor — switch between spoken text (TTS) and a pre-recorded audio
 * file.
 *
 * Audio mode lists the current user's uploaded IVR sounds in a dropdown (label =
 * original file name) and lets them upload a new one inline. The selected
 * VALUE is the sounds-root-relative playback path the Go upload returns
 * (`<ext>/<datetime>/<name>.wav`); the IVR runtime prepends the shared sounds
 * base and FreeSWITCH plays it from the mounted volume.
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { Upload, Mic, Search, Play, Pause } from "lucide-react";

import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { goApi, type GoSound, type GoSystemSound } from "../../../lib/go-api";
import { getGoApiBase } from "../../../lib/runtime-config";
import { useAuthStore } from "../../../stores";
import type { Prompt } from "../ivr.types";
import { AudioRecorderModal, recorderSupported } from "./AudioRecorderModal";

// Shared across PromptEditor mounts so switching nodes doesn't refetch the
// user's sound list. Reset to null to force a reload after a new upload.
let ivrSoundsCache: GoSound[] | null = null;
// Built-in FS library sounds are global + immutable, so cache them process-wide.
let sysSoundsCache: GoSystemSound[] | null = null;

// FS sound-tree root the library sits under; `system:` prompts resolve here in
// the IVR runtime (renderPrompt) straight off the sounds base, not the /ivr dir.
const SYSTEM_SOUNDS_ROOT = "en/us/callie";
const systemValue = (s: GoSystemSound) =>
  `system:${SYSTEM_SOUNDS_ROOT}/${s.category}/8000/${s.file}`;
const prettyName = (n: string) =>
  n
    .replace(/\.wav$/i, "")
    .replace(/^ivr[-_]/, "")
    .replace(/[-_]/g, " ");

export function PromptEditor({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Prompt;
  onChange: (next: Prompt) => void;
}) {
  const ext = useAuthStore((s) => s.user?.extension);
  const [sounds, setSounds] = useState<GoSound[]>(ivrSoundsCache ?? []);
  const [sysSounds, setSysSounds] = useState<GoSystemSound[]>(
    sysSoundsCache ?? [],
  );
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recorderOpen, setRecorderOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [previewing, setPreviewing] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const loadSounds = async () => {
    if (!ext) return;
    const all = await goApi.getSounds(ext);
    const ivr = all.filter((s) => s.type === "ivr");
    ivrSoundsCache = ivr;
    setSounds(ivr);
  };

  // Fetch the user's IVR sounds the first time audio mode is shown.
  useEffect(() => {
    if (value.mode !== "audio" || !ext || ivrSoundsCache) return;
    let cancelled = false;
    setLoading(true);
    goApi
      .getSounds(ext)
      .then((all) => {
        if (cancelled) return;
        const ivr = all.filter((s) => s.type === "ivr");
        ivrSoundsCache = ivr;
        setSounds(ivr);
      })
      .catch(() => {
        /* uploaded sounds are optional; ignore load failures */
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [value.mode, ext]);

  // Load the built-in FS library (IVR category) once — global + immutable.
  useEffect(() => {
    if (value.mode !== "audio" || sysSoundsCache) return;
    let cancelled = false;
    goApi
      .getSystemSounds("ivr")
      .then((list) => {
        if (cancelled) return;
        sysSoundsCache = list;
        setSysSounds(list);
      })
      .catch(() => {
        /* the built-in library is optional; ignore load failures */
      });
    return () => {
      cancelled = true;
    };
  }, [value.mode]);

  // Shared by the Upload picker and the recorder modal; resolves true on success
  // so the modal knows it can close.
  const uploadFile = async (file: File): Promise<boolean> => {
    // Fast client-side guard mirroring the server's 250KB cap.
    if (file.size > 250 * 1024) {
      setError("File too large (max 250KB).");
      return false;
    }
    setError(null);
    setUploading(true);
    try {
      // Extension is derived from the JWT server-side; the returned filename is
      // the relative playback path to store on the prompt.
      const { filename } = await goApi.uploadSound("ivr", file);
      ivrSoundsCache = null;
      await loadSounds();
      onChange({ ...value, mode: "audio", audioFile: filename });
      return true;
    } catch {
      setError("Upload failed. Please try again.");
      return false;
    } finally {
      setUploading(false);
    }
  };

  const handleUpload = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "audio/*";
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) void uploadFile(file);
    };
    input.click();
  };

  // Browser preview URL for a stored value (served by the Go API static routes;
  // FreeSWITCH plays the real file from the shared volume — this is browser-only).
  const previewUrl = (val: string): string => {
    const base = getGoApiBase();
    if (val.startsWith("system:")) {
      const rest = val.slice("system:".length).replace(/^en\/us\/callie\//, "");
      return `${base}/system-sounds/${rest}`;
    }
    return `${base}/ivr-sounds/${val}`;
  };

  const togglePreview = (val: string) => {
    const el = audioRef.current;
    if (!el) return;
    if (previewing === val && !el.paused) {
      el.pause();
      setPreviewing(null);
      return;
    }
    el.src = previewUrl(val);
    setError(null);
    el.play()
      .then(() => setPreviewing(val))
      .catch(() => {
        setPreviewing(null);
        setError("Preview unavailable.");
      });
  };

  const current = value.audioFile ?? "";
  const q = query.trim().toLowerCase();
  const matches = (t: string) => !q || t.toLowerCase().includes(q);
  const filteredUploads = sounds.filter(
    (s) => matches(s.original_name) || matches(s.filename),
  );
  const filteredSystem = sysSounds.filter(
    (s) => matches(prettyName(s.name)) || matches(s.category),
  );
  const currentLabel = prettyName(current.split("/").pop() ?? current);

  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <div className="flex gap-1 rounded-lg bg-muted/50 p-0.5">
        {(["tts", "audio"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => onChange({ ...value, mode })}
            className={cn(
              "flex-1 rounded-md px-2 py-1 text-xs font-medium transition-colors",
              value.mode === mode
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {mode === "tts" ? "Text (TTS)" : "Audio file"}
          </button>
        ))}
      </div>
      {value.mode === "tts" ? (
        <Textarea
          rows={3}
          value={value.text ?? ""}
          placeholder="What the caller hears…"
          onChange={(e) => onChange({ ...value, text: e.target.value })}
          className="text-sm"
        />
      ) : (
        <div className="space-y-1.5">
          {/* Search */}
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search sounds…"
              className="h-8 w-full rounded-md border border-input bg-transparent pl-7 pr-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>

          {/* Current selection with quick preview */}
          {current && (
            <div className="flex items-center justify-between gap-2 rounded-md bg-muted/50 px-2 py-1">
              <span className="truncate text-xs">
                <span className="text-muted-foreground">Selected: </span>
                {currentLabel}
              </span>
              <button
                type="button"
                onClick={() => togglePreview(current)}
                className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground"
                title="Preview selected"
                aria-label="Preview selected"
              >
                {previewing === current ? (
                  <Pause className="h-3.5 w-3.5" />
                ) : (
                  <Play className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
          )}

          {/* Sound list — click a name to select, ▶ to hear it */}
          <div className="max-h-52 space-y-2 overflow-y-auto rounded-lg border border-border/60 p-1.5">
            <div>
              <p className="px-1 pb-1 text-[11px] font-medium text-muted-foreground">
                Your uploads
              </p>
              {filteredUploads.length === 0 ? (
                <p className="px-1 py-1 text-xs text-muted-foreground/70">
                  {loading ? "Loading…" : q ? "No matches" : "No uploads yet"}
                </p>
              ) : (
                filteredUploads.map((s) => (
                  <SoundRow
                    key={s.id}
                    label={s.original_name}
                    selected={current === s.filename}
                    playing={previewing === s.filename}
                    onSelect={() =>
                      onChange({ ...value, audioFile: s.filename })
                    }
                    onPreview={() => togglePreview(s.filename)}
                  />
                ))
              )}
            </div>
            <div>
              <p className="px-1 pb-1 text-[11px] font-medium text-muted-foreground">
                System library
              </p>
              {filteredSystem.length === 0 ? (
                <p className="px-1 py-1 text-xs text-muted-foreground/70">
                  {q ? "No matches" : "None available"}
                </p>
              ) : (
                filteredSystem.map((s) => {
                  const val = systemValue(s);
                  return (
                    <SoundRow
                      key={`${s.category}/${s.file}`}
                      label={prettyName(s.name)}
                      selected={current === val}
                      playing={previewing === val}
                      onSelect={() => onChange({ ...value, audioFile: val })}
                      onPreview={() => togglePreview(val)}
                    />
                  );
                })
              )}
            </div>
          </div>
          <div className="flex gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={handleUpload}
              disabled={uploading}
            >
              <Upload className="mr-1.5 h-3.5 w-3.5" />
              {uploading ? "Uploading…" : "Upload"}
            </Button>
            {recorderSupported && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={() => setRecorderOpen(true)}
                disabled={uploading}
              >
                <Mic className="mr-1.5 h-3.5 w-3.5" />
                Record
              </Button>
            )}
          </div>
          {error && <p className="text-[11px] text-destructive">{error}</p>}

          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <audio
            ref={audioRef}
            className="hidden"
            onEnded={() => setPreviewing(null)}
          />
          <AudioRecorderModal
            open={recorderOpen}
            onOpenChange={setRecorderOpen}
            onSave={uploadFile}
          />
        </div>
      )}
    </div>
  );
}

function SoundRow({
  label,
  selected,
  playing,
  onSelect,
  onPreview,
}: {
  label: string;
  selected: boolean;
  playing: boolean;
  onSelect: () => void;
  onPreview: () => void;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-1 rounded-md pr-1",
        selected && "bg-primary/10",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          "flex-1 truncate rounded-md px-2 py-1.5 text-left text-xs",
          selected
            ? "font-medium text-foreground"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        {label}
      </button>
      <button
        type="button"
        onClick={onPreview}
        className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground"
        title="Preview"
        aria-label="Preview"
      >
        {playing ? (
          <Pause className="h-3.5 w-3.5" />
        ) : (
          <Play className="h-3.5 w-3.5" />
        )}
      </button>
    </div>
  );
}
