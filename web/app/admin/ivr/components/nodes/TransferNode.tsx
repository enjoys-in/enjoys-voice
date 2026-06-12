"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { NODE_META } from "../../ivr.constants";
import type { TransferNode as TransferNodeType } from "../../ivr.types";
import { NodeShell } from "./NodeShell";

export function TransferNode({ data, selected }: NodeProps<TransferNodeType>) {
  const target = data.department || data.extension;
  return (
    <NodeShell meta={NODE_META.transfer} selected={!!selected} title={data.label}>
      <Handle type="target" position={Position.Left} style={{ width: 12, height: 12, background: "#f59e0b" }} />
      <p>
        →{" "}
        <span className="font-mono text-foreground">
          {target || <span className="italic text-muted-foreground/60">unset</span>}
        </span>
      </p>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
        {data.attended ? "attended" : "blind"} · {data.ringSeconds}s
      </p>
    </NodeShell>
  );
}
