/**
 * Top-level IVR builder: toolbar + palette + canvas + inspector.
 * Wraps everything in a ReactFlowProvider so the canvas can use viewport hooks.
 */
"use client";

import "@xyflow/react/dist/style.css";

import { ReactFlowProvider } from "@xyflow/react";
import { Toolbar } from "./Toolbar";
import { NodePalette } from "./NodePalette";
import { FlowCanvas } from "./FlowCanvas";
import { NodeInspector } from "./NodeInspector";

export function IvrBuilder({ onBack }: { onBack: () => void }) {
  return (
    <ReactFlowProvider>
      <div className="flex h-dvh flex-col">
        <Toolbar onBack={onBack} />
        <div className="flex min-h-0 flex-1">
          <NodePalette />
          <FlowCanvas />
          <NodeInspector />
        </div>
      </div>
    </ReactFlowProvider>
  );
}
