/**
 * Prompt editor — switch between spoken text (TTS) and an audio file.
 *
 * The audio mode currently takes a file name; a future upload control can set
 * this field (the file is served at /sounds/<name> and copied into the
 * FreeSWITCH sounds mount at play time).
 */
"use client";

import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { Prompt } from "../ivr.types";

export function PromptEditor({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Prompt;
  onChange: (next: Prompt) => void;
}) {
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
        <Input
          value={value.audioFile ?? ""}
          placeholder="greeting.wav"
          onChange={(e) => onChange({ ...value, audioFile: e.target.value })}
          className="text-sm"
        />
      )}
    </div>
  );
}
