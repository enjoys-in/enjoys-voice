/**
 * The React Flow canvas, controlled by the builder store.
 * Must be rendered inside a <ReactFlowProvider> (see IvrBuilder).
 */
"use client";

import { useCallback } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useReactFlow,
  type ColorMode,
} from "@xyflow/react";

import { useBuilderStore } from "../store/builder.store";
import { ivrNodeTypes } from "./nodes";
import type { IvrEdge, IvrNode, IvrNodeKind } from "../ivr.types";

export function FlowCanvas() {
  const nodes = useBuilderStore((s) => s.nodes);
  const edges = useBuilderStore((s) => s.edges);
  const onNodesChange = useBuilderStore((s) => s.onNodesChange);
  const onEdgesChange = useBuilderStore((s) => s.onEdgesChange);
  const onConnect = useBuilderStore((s) => s.onConnect);
  const addNode = useBuilderStore((s) => s.addNode);
  const selectNode = useBuilderStore((s) => s.selectNode);

  const { screenToFlowPosition } = useReactFlow();

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const kind = e.dataTransfer.getData("application/ivr-node") as IvrNodeKind;
      if (!kind) return;
      const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      addNode(kind, position);
    },
    [screenToFlowPosition, addNode],
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  return (
    <div className="relative flex-1" onDrop={onDrop} onDragOver={onDragOver}>
      <ReactFlow<IvrNode, IvrEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={ivrNodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={(_, node) => selectNode(node.id)}
        onPaneClick={() => selectNode(null)}
        colorMode={"system" as ColorMode}
        fitView
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{ animated: true }}
      >
        <Background gap={16} />
        <Controls />
        <MiniMap pannable zoomable style={{ background: "var(--card)" }} />
      </ReactFlow>
    </div>
  );
}
