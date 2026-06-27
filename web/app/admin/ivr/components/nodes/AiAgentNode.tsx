"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { NODE_META } from "../../ivr.constants";
import type { AiAgentNode as AiAgentNodeType } from "../../ivr.types";
import { NodeShell } from "./NodeShell";

export function AiAgentNode({ data, selected }: NodeProps<AiAgentNodeType>) {
  return (
    <NodeShell meta={NODE_META.ai_agent} selected={!!selected} title={data.label}>
      <Handle type="target" position={Position.Left} style={{ width: 12, height: 12, background: "#06b6d4" }} />
      {data.agentId ? (
        <p className="truncate">agent #{data.agentId}</p>
      ) : (
        <p className="italic text-amber-600 dark:text-amber-400">no agent selected</p>
      )}
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
        AI answers the call
      </p>
    </NodeShell>
  );
}
