/**
 * Left palette — click (or drag) a block to add it to the canvas.
 */
"use client";

import { cn } from "@/lib/utils";
import { NODE_META, PALETTE_KINDS } from "../ivr.constants";
import { useBuilderStore } from "../store/builder.store";
import type { IvrNodeKind } from "../ivr.types";

export function NodePalette() {
  const addNode = useBuilderStore((s) => s.addNode);

  const onDragStart = (e: React.DragEvent, kind: IvrNodeKind) => {
    e.dataTransfer.setData("application/ivr-node", kind);
    e.dataTransfer.effectAllowed = "move";
  };

  return (
    <div className="w-56 shrink-0 border-r border-border/50 bg-card/30 p-3">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Blocks
      </h3>
      <p className="mb-3 text-[11px] text-muted-foreground/70">
        Click to add, or drag onto the canvas.
      </p>
      <div className="space-y-2">
        {PALETTE_KINDS.map((kind) => {
          const meta = NODE_META[kind];
          const Icon = meta.icon;
          const accentText = meta.accent.split(" ")[0];
          return (
            <button
              key={kind}
              draggable
              onDragStart={(e) => onDragStart(e, kind)}
              onClick={() => addNode(kind)}
              className={cn(
                "flex w-full items-start gap-2.5 rounded-lg border border-border/60 bg-card p-2.5 text-left transition-colors hover:border-primary/40 hover:bg-accent/40 cursor-grab active:cursor-grabbing",
              )}
            >
              <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", accentText)} />
              <span className="min-w-0">
                <span className="block text-sm font-medium">{meta.title}</span>
                <span className="block text-[11px] leading-tight text-muted-foreground">
                  {meta.description}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
