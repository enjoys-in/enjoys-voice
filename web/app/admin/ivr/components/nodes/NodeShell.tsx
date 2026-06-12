/**
 * Shared visual shell for every IVR node, so the canvas reads consistently.
 */
"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { NodeMeta } from "../../ivr.constants";

export function NodeShell({
  meta,
  selected,
  title,
  children,
  width = 220,
}: {
  meta: NodeMeta;
  selected: boolean;
  title: string;
  children?: ReactNode;
  width?: number;
}) {
  const Icon = meta.icon;
  const accentText = meta.accent.split(" ")[0];
  return (
    <div
      style={{ width }}
      className={cn(
        "rounded-xl border bg-card shadow-sm transition-shadow",
        selected ? "ring-2 ring-primary border-primary/50" : "border-border/60",
      )}
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/50">
        <Icon className={cn("h-4 w-4 shrink-0", accentText)} />
        <span className="text-sm font-medium truncate flex-1">{title}</span>
      </div>
      <div className="px-3 py-2 text-xs text-muted-foreground space-y-1.5">
        {children}
      </div>
    </div>
  );
}

/** One-line prompt preview ("text" or 🔊 file). */
export function PromptPreview({
  prompt,
}: {
  prompt: { mode: "tts" | "audio"; text?: string; audioFile?: string };
}) {
  if (prompt.mode === "audio") {
    return (
      <p className="truncate">
        🔊 {prompt.audioFile || <span className="italic">no file</span>}
      </p>
    );
  }
  return (
    <p className="line-clamp-2 italic">
      “{prompt.text || "…"}”
    </p>
  );
}
