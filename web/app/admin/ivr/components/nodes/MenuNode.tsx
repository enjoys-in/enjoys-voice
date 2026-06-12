"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { NODE_META } from "../../ivr.constants";
import type { MenuNode as MenuNodeType } from "../../ivr.types";
import { NodeShell, PromptPreview } from "./NodeShell";

export function MenuNode({ data, selected }: NodeProps<MenuNodeType>) {
  return (
    <NodeShell meta={NODE_META.menu} selected={!!selected} title={data.label} width={240}>
      {/* Input */}
      <Handle
        type="target"
        position={Position.Left}
        style={{ width: 12, height: 12, background: "#0ea5e9" }}
      />

      <PromptPreview prompt={data.prompt} />
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
        tries {data.tries} · {Math.round(data.timeoutMs / 1000)}s
      </p>

      {/* One output handle per digit option, anchored to its row. */}
      <div className="mt-1 space-y-1">
        {data.options.length === 0 && (
          <p className="italic text-muted-foreground/60">no options</p>
        )}
        {data.options.map((opt) => (
          <div
            key={opt.id}
            className="relative flex items-center gap-2 rounded-md bg-muted/40 px-2 py-1"
          >
            <span className="flex h-5 w-5 items-center justify-center rounded bg-sky-500/15 font-mono text-[11px] font-semibold text-sky-600 dark:text-sky-400">
              {opt.digit}
            </span>
            <span className="truncate text-[11px] text-foreground/80">
              {opt.label || <span className="italic text-muted-foreground/60">unlabeled</span>}
            </span>
            <Handle
              id={opt.id}
              type="source"
              position={Position.Right}
              style={{ right: -18, top: "50%", width: 12, height: 12, background: "#0ea5e9" }}
            />
          </div>
        ))}
      </div>
    </NodeShell>
  );
}
