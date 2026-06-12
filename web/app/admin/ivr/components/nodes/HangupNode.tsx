"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { NODE_META } from "../../ivr.constants";
import type { HangupNode as HangupNodeType } from "../../ivr.types";
import { NodeShell } from "./NodeShell";

export function HangupNode({ data, selected }: NodeProps<HangupNodeType>) {
  return (
    <NodeShell meta={NODE_META.hangup} selected={!!selected} title={data.label}>
      <Handle type="target" position={Position.Left} style={{ width: 12, height: 12, background: "#f43f5e" }} />
      <p className="italic text-muted-foreground/70">Ends the call.</p>
    </NodeShell>
  );
}
