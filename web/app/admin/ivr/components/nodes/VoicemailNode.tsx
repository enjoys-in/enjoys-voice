"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { NODE_META } from "../../ivr.constants";
import type { VoicemailNode as VoicemailNodeType } from "../../ivr.types";
import { NodeShell, PromptPreview } from "./NodeShell";

export function VoicemailNode({ data, selected }: NodeProps<VoicemailNodeType>) {
  return (
    <NodeShell meta={NODE_META.voicemail} selected={!!selected} title={data.label}>
      <Handle type="target" position={Position.Left} style={{ width: 12, height: 12, background: "#ec4899" }} />
      <PromptPreview prompt={data.greeting} />
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
        mailbox {data.mailbox || "caller ext"} · max {data.maxSeconds}s
      </p>
    </NodeShell>
  );
}
