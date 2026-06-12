"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  NODE_META,
  OPERATOR_LABELS,
  VARIABLE_LABELS,
} from "../../ivr.constants";
import type { ConditionNode as ConditionNodeType } from "../../ivr.types";
import { NodeShell } from "./NodeShell";

export function ConditionNode({ data, selected }: NodeProps<ConditionNodeType>) {
  const variable =
    data.variable === "custom"
      ? data.customVariable || "variable"
      : VARIABLE_LABELS[data.variable];

  return (
    <NodeShell meta={NODE_META.condition} selected={!!selected} title={data.label} width={244}>
      <Handle
        type="target"
        position={Position.Left}
        style={{ width: 12, height: 12, background: "#6366f1" }}
      />

      <p className="leading-snug">
        <span className="font-mono text-foreground">{variable}</span>{" "}
        <span className="text-muted-foreground">{OPERATOR_LABELS[data.operator]}</span>{" "}
        <span className="font-mono text-foreground">
          {data.value || <span className="italic text-muted-foreground/60">…</span>}
        </span>
      </p>

      {/* true / false branches, each owning a source handle */}
      <div className="mt-1 space-y-1">
        <div className="relative flex items-center gap-2 rounded-md bg-emerald-500/10 px-2 py-1">
          <span className="flex h-5 items-center rounded bg-emerald-500/15 px-1.5 font-mono text-[10px] font-semibold uppercase text-emerald-600 dark:text-emerald-400">
            if true
          </span>
          <span className="truncate text-[11px] text-muted-foreground">→ then</span>
          <Handle
            id="true"
            type="source"
            position={Position.Right}
            style={{ right: -18, top: "50%", width: 12, height: 12, background: "#10b981" }}
          />
        </div>
        <div className="relative flex items-center gap-2 rounded-md bg-rose-500/10 px-2 py-1">
          <span className="flex h-5 items-center rounded bg-rose-500/15 px-1.5 font-mono text-[10px] font-semibold uppercase text-rose-600 dark:text-rose-400">
            else
          </span>
          <span className="truncate text-[11px] text-muted-foreground">→ otherwise</span>
          <Handle
            id="false"
            type="source"
            position={Position.Right}
            style={{ right: -18, top: "50%", width: 12, height: 12, background: "#f43f5e" }}
          />
        </div>
      </div>
    </NodeShell>
  );
}
