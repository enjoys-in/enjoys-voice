"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { NODE_META } from "../../ivr.constants";
import type { PlayNode as PlayNodeType } from "../../ivr.types";
import { NodeShell, PromptPreview } from "./NodeShell";

export function PlayNode({ data, selected }: NodeProps<PlayNodeType>) {
  return (
    <NodeShell meta={NODE_META.play} selected={!!selected} title={data.label}>
      <Handle type="target" position={Position.Left} style={{ width: 12, height: 12, background: "#8b5cf6" }} />
      <PromptPreview prompt={data.prompt} />
      {data.bargeIn && (
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
          barge-in on
        </p>
      )}
      <Handle type="source" position={Position.Right} style={{ width: 12, height: 12, background: "#8b5cf6" }} />
    </NodeShell>
  );
}
