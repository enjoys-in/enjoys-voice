"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { NODE_META } from "../../ivr.constants";
import type { StartNode as StartNodeType } from "../../ivr.types";
import { NodeShell, PromptPreview } from "./NodeShell";

export function StartNode({ data, selected }: NodeProps<StartNodeType>) {
  return (
    <NodeShell meta={NODE_META.start} selected={!!selected} title={data.label}>
      <p>
        Ext{" "}
        <span className="font-mono text-foreground">
          {data.extension || "—"}
        </span>
      </p>
      <PromptPreview prompt={data.greeting} />
      <Handle
        type="source"
        position={Position.Right}
        style={{ width: 12, height: 12, background: "#10b981" }}
      />
    </NodeShell>
  );
}
