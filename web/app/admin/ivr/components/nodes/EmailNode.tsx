"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { NODE_META } from "../../ivr.constants";
import type { EmailNode as EmailNodeType } from "../../ivr.types";
import { NodeShell } from "./NodeShell";

export function EmailNode({ data, selected }: NodeProps<EmailNodeType>) {
  return (
    <NodeShell meta={NODE_META.email} selected={!!selected} title={data.label}>
      <Handle type="target" position={Position.Left} style={{ width: 12, height: 12, background: "#14b8a6" }} />
      <p className="truncate">
        {data.connectorId ? (
          <>to {data.to || <span className="italic">—</span>}</>
        ) : (
          <span className="italic text-amber-600 dark:text-amber-400">
            no connector
          </span>
        )}
      </p>
      {data.subject && <p className="truncate">“{data.subject}”</p>}
      <span className="inline-block rounded bg-teal-500/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-teal-600 dark:text-teal-400">
        experimental
      </span>
      <Handle type="source" position={Position.Right} style={{ width: 12, height: 12, background: "#14b8a6" }} />
    </NodeShell>
  );
}
