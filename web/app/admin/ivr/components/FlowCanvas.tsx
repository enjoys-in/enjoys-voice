/**
 * The React Flow canvas, controlled by the builder store.
 * Must be rendered inside a <ReactFlowProvider> (see IvrBuilder).
 *
 * Adds a custom right-click context menu (copy/cut/paste/duplicate/delete,
 * add block, fit view, clear) and keyboard shortcuts.
 */
"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useReactFlow,
  type ColorMode,
  type Edge,
  type Node,
} from "@xyflow/react";

import { useBuilderStore } from "../store/builder.store";
import { ivrNodeTypes } from "./nodes";
import { FlowContextMenu, type FlowMenuState } from "./FlowContextMenu";
import type { IvrEdge, IvrNode, IvrNodeKind } from "../ivr.types";

function isTypingTarget(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null;
  if (!node) return false;
  const tag = node.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    node.isContentEditable
  );
}

export function FlowCanvas() {
  const nodes = useBuilderStore((s) => s.nodes);
  const edges = useBuilderStore((s) => s.edges);
  const onNodesChange = useBuilderStore((s) => s.onNodesChange);
  const onEdgesChange = useBuilderStore((s) => s.onEdgesChange);
  const onConnect = useBuilderStore((s) => s.onConnect);
  const addNode = useBuilderStore((s) => s.addNode);
  const selectNode = useBuilderStore((s) => s.selectNode);
  const readOnly = useBuilderStore((s) => s.readOnly);

  const [menu, setMenu] = useState<FlowMenuState>(null);
  const closeMenu = useCallback(() => setMenu(null), []);

  const { screenToFlowPosition } = useReactFlow();

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      if (readOnly) return;
      const kind = e.dataTransfer.getData("application/ivr-node") as IvrNodeKind;
      if (!kind) return;
      const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      addNode(kind, position);
    },
    [screenToFlowPosition, addNode, readOnly],
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  // ─── context menu handlers ──────────────────────────
  const onNodeContextMenu = useCallback(
    (e: React.MouseEvent, node: Node) => {
      e.preventDefault();
      selectNode(node.id);
      if (readOnly) return;
      setMenu({ type: "node", nodeId: node.id, x: e.clientX, y: e.clientY });
    },
    [selectNode, readOnly],
  );

  const onEdgeContextMenu = useCallback((e: React.MouseEvent, edge: Edge) => {
    e.preventDefault();
    if (readOnly) return;
    setMenu({ type: "edge", edgeId: edge.id, x: e.clientX, y: e.clientY });
  }, [readOnly]);

  const onPaneContextMenu = useCallback((e: React.MouseEvent | MouseEvent) => {
    e.preventDefault();
    if (readOnly) return;
    setMenu({ type: "pane", x: e.clientX, y: e.clientY });
  }, [readOnly]);

  // ─── keyboard shortcuts ─────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const s = useBuilderStore.getState();
      if (s.readOnly) return;
      const sel = s.selectedNodeId;
      const key = e.key.toLowerCase();

      // Delete / Backspace → remove the selected node (start node is protected).
      if (key === "delete" || key === "backspace") {
        if (sel) {
          e.preventDefault();
          s.removeNode(sel);
        }
        return;
      }

      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      if (key === "z") {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
      } else if (key === "y") {
        e.preventDefault();
        s.redo();
      } else if (key === "c" && sel) {
        s.copyNode(sel);
      } else if (key === "x" && sel) {
        s.cutNode(sel);
      } else if (key === "v") {
        e.preventDefault();
        s.pasteNode();
      } else if (key === "d" && sel) {
        e.preventDefault();
        s.duplicateNode(sel);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
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
        nodesDraggable={!readOnly}
        nodesConnectable={!readOnly}
        onNodeClick={(_, node) => selectNode(node.id)}
        onPaneClick={() => {
          selectNode(null);
          closeMenu();
        }}
        onNodeContextMenu={onNodeContextMenu}
        onEdgeContextMenu={onEdgeContextMenu}
        onPaneContextMenu={onPaneContextMenu}
        onMoveStart={closeMenu}
        colorMode={"system" as ColorMode}
        fitView
        fitViewOptions={{ maxZoom: 0.85, padding: 0.3 }}
        minZoom={0.2}
        deleteKeyCode={null}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{ animated: true }}
      >
        <Background gap={16} />
        <Controls />
        <MiniMap pannable zoomable style={{ background: "var(--card)" }} />
      </ReactFlow>

      <FlowContextMenu menu={menu} onClose={closeMenu} />
    </div>
  );
}
