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

import { useEffect, useState } from "react";
import { Upload, Mic } from "lucide-react";

import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

import { goApi, type GoSound, type GoSystemSound } from "../../../lib/go-api";
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

  const current = value.audioFile ?? "";
  // Show the current pick as a fallback item when its list hasn't loaded yet
  // (covers both uploads and `system:` library values).
  const currentUnlisted =
    !!current &&
    !sounds.some((s) => s.filename === current) &&
    !sysSounds.some((s) => systemValue(s) === current);

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
          <Select
            value={current}
            onValueChange={(audioFile) => onChange({ ...value, audioFile })}
          >
            <SelectTrigger className="w-full text-sm">
              <SelectValue
                placeholder={loading ? "Loading…" : "Select an audio file"}
              />
            </SelectTrigger>
            <SelectContent>
              {currentUnlisted && (
                <SelectItem value={current}>
                  {prettyName(current.split("/").pop() ?? current)} (current)
                </SelectItem>
              )}
              <SelectGroup>
                <SelectLabel className="text-[11px]">Your uploads</SelectLabel>
                {sounds.length === 0 ? (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">
                    {loading ? "Loading…" : "No uploads yet"}
                  </div>
                ) : (
                  sounds.map((s) => (
                    <SelectItem key={s.id} value={s.filename}>
                      {s.original_name}
                    </SelectItem>
                  ))
                )}
              </SelectGroup>
              {sysSounds.length > 0 && (
                <SelectGroup>
                  <SelectLabel className="text-[11px]">
                    System library
                  </SelectLabel>
                  {sysSounds.map((s) => (
                    <SelectItem
                      key={`${s.category}/${s.file}`}
                      value={systemValue(s)}
                    >
                      {prettyName(s.name)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
            </SelectContent>
          </Select>
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
