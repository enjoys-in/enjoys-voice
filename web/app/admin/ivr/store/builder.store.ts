/**
 * IVR builder store (Zustand).
 *
 * Holds the in-progress flow graph and drives the React Flow canvas in a
 * controlled fashion (nodes/edges live here, not inside <ReactFlow>). It also
 * keeps the menu-option ↔ source-handle ↔ edge relationship consistent:
 * removing an option drops the edges that left its handle.
 */
import { create } from "zustand";
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type XYPosition,
} from "@xyflow/react";

import { ivrApi } from "../ivr.api";
import { defaultNodeData, makeMenuOption } from "../ivr.constants";
import type {
  DtmfDigit,
  IvrEdge,
  IvrFlow,
  IvrNode,
  IvrNodeData,
  IvrNodeKind,
  MenuNodeData,
} from "../ivr.types";

// ─── id helpers ─────────────────────────────────────────

let nodeSeq = 0;
function newNodeId(kind: IvrNodeKind): string {
  nodeSeq += 1;
  return `${kind}_${Date.now().toString(36)}_${nodeSeq}`;
}

function newFlowId(): string {
  return `flow_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * React Flow hard-crashes ("Cannot read properties of undefined (reading 'x')")
 * if any node lacks a numeric `position`. Flows persisted without layout — e.g.
 * the seeded demo IVR, or graphs authored via the API — come back position-less,
 * so backfill a tidy diagonal cascade the user can rearrange and re-save.
 */
function withSafePosition(node: IvrNode, index: number): IvrNode {
  const p = node.position as XYPosition | undefined;
  if (p && typeof p.x === "number" && typeof p.y === "number") return node;
  return {
    ...node,
    position: { x: 80 + index * 240, y: 80 + index * 140 },
  } as IvrNode;
}

/**
 * Deep-clone node data for copy/paste/duplicate. Menu options get fresh handle
 * ids so a pasted menu never shares a source-handle id with its origin.
 */
function cloneNodeData(data: IvrNodeData): IvrNodeData {
  const cloned = structuredClone(data);
  if (cloned.kind === "menu") {
    cloned.options = cloned.options.map((o) => ({
      ...o,
      id: `opt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    }));
  }
  return cloned;
}

// ─── undo / redo history ────────────────────────────────

type HistorySnapshot = { nodes: IvrNode[]; edges: IvrEdge[] };

const HISTORY_LIMIT = 50;

/**
 * True while a node is mid-drag, so a continuous drag pushes exactly one
 * history entry (captured at drag-start) instead of one per pointer move.
 */
let dragActive = false;

/**
 * Returns the `past`/`future` patch that records the current graph as an undo
 * checkpoint. Spread into a `set` patch BEFORE mutating nodes/edges.
 */
function pushHistory(s: BuilderState): Pick<BuilderState, "past" | "future"> {
  return {
    past: [...s.past, { nodes: s.nodes, edges: s.edges }].slice(-HISTORY_LIMIT),
    future: [],
  };
}

// ─── factory: a brand-new flow with a single start node ─

export function createEmptyFlow(name: string, extension: string): IvrFlow {
  const now = new Date().toISOString();
  const start: IvrNode = {
    id: newNodeId("start"),
    type: "start",
    position: { x: 80, y: 200 },
    data: defaultNodeData("start", extension),
    deletable: false,
  } as IvrNode;
  return {
    id: newFlowId(),
    name,
    extension,
    enabled: true,
    nodes: [start],
    edges: [],
    createdAt: now,
    updatedAt: now,
  };
}

// ─── store shape ────────────────────────────────────────

interface BuilderState {
  flowId: string | null;
  name: string;
  extension: string;
  enabled: boolean;
  nodes: IvrNode[];
  edges: IvrEdge[];
  selectedNodeId: string | null;
  clipboard: IvrNodeData | null;
  past: HistorySnapshot[];
  future: HistorySnapshot[];
  dirty: boolean;
  saving: boolean;
  // When true the flow is shown view-only (non-admin); all mutations are no-ops.
  readOnly: boolean;

  // lifecycle
  loadFlow: (flow: IvrFlow) => void;
  startNewFlow: (name: string, extension: string) => void;
  save: () => Promise<IvrFlow | null>;
  reset: () => void;
  setReadOnly: (v: boolean) => void;

  // flow meta
  setMeta: (patch: Partial<Pick<IvrFlow, "name" | "extension" | "enabled">>) => void;

  // React Flow controlled handlers
  onNodesChange: (changes: NodeChange<IvrNode>[]) => void;
  onEdgesChange: (changes: EdgeChange<IvrEdge>[]) => void;
  onConnect: (connection: Connection) => void;

  // node ops
  addNode: (kind: IvrNodeKind, position?: XYPosition) => void;
  updateNodeData: (id: string, patch: Partial<IvrNodeData>) => void;
  removeNode: (id: string) => void;
  removeEdge: (id: string) => void;
  selectNode: (id: string | null) => void;

  // clipboard / duplicate / bulk
  copyNode: (id: string) => void;
  cutNode: (id: string) => void;
  pasteNode: (position?: XYPosition) => void;
  duplicateNode: (id: string) => void;
  clearAll: () => void;
  undo: () => void;
  redo: () => void;

  // menu-option ops (keep handles + edges in sync)
  addMenuOption: (nodeId: string, digit: DtmfDigit) => void;
  updateMenuOption: (
    nodeId: string,
    optionId: string,
    patch: Partial<{ digit: DtmfDigit; label: string }>,
  ) => void;
  removeMenuOption: (nodeId: string, optionId: string) => void;

  // derived
  getSelectedNode: () => IvrNode | null;
}

export const useBuilderStore = create<BuilderState>((set, get) => ({
  flowId: null,
  name: "",
  extension: "",
  enabled: true,
  nodes: [],
  edges: [],
  selectedNodeId: null,
  clipboard: null,
  past: [],
  future: [],
  dirty: false,
  saving: false,
  readOnly: false,

  loadFlow: (flow) =>
    set({
      flowId: flow.id,
      name: flow.name,
      extension: flow.extension,
      enabled: flow.enabled,
      nodes: flow.nodes.map((n, i) => {
        const node = withSafePosition(n, i);
        return node.type === "start"
          ? ({ ...node, deletable: false } as IvrNode)
          : node;
      }),
      edges: flow.edges,
      selectedNodeId: null,
      past: [],
      future: [],
      dirty: false,
    }),

  startNewFlow: (name, extension) => {
    const flow = createEmptyFlow(name, extension);
    set({
      flowId: flow.id,
      name: flow.name,
      extension: flow.extension,
      enabled: flow.enabled,
      nodes: flow.nodes,
      edges: flow.edges,
      selectedNodeId: null,
      past: [],
      future: [],
      dirty: true,
    });
  },

  save: async () => {
    const s = get();
    if (s.readOnly || !s.flowId) return null;
    set({ saving: true });
    try {
      const saved = await ivrApi.saveFlow({
        id: s.flowId,
        name: s.name,
        extension: s.extension,
        enabled: s.enabled,
        nodes: s.nodes,
        edges: s.edges,
        createdAt: new Date().toISOString(), // preserved server-side on update
        updatedAt: new Date().toISOString(),
      });
      set({ dirty: false, saving: false });
      return saved;
    } catch (err) {
      console.error("Failed to save IVR flow:", err);
      set({ saving: false });
      return null;
    }
  },

  reset: () =>
    set({
      flowId: null,
      name: "",
      extension: "",
      enabled: true,
      nodes: [],
      edges: [],
      selectedNodeId: null,
      past: [],
      future: [],
      dirty: false,
      saving: false,
    }),

  setReadOnly: (v) => set({ readOnly: v }),

  setMeta: (patch) => set((s) => (s.readOnly ? s : { ...s, ...patch, dirty: true })),

  onNodesChange: (changes) =>
    set((s) => {
      if (s.readOnly) {
        // View-only: keep selection/measurement, drop position/add/remove.
        const safe = changes.filter((c) => c.type === "select" || c.type === "dimensions");
        return { nodes: applyNodeChanges(safe, s.nodes) };
      }
      // Record one undo checkpoint per discrete edit: at the start of a drag
      // (so undo restores the pre-drag layout) and on any node removal.
      const hasRemove = changes.some((c) => c.type === "remove");
      const dragStart = changes.some(
        (c) => c.type === "position" && c.dragging === true,
      );
      const dragEnd = changes.some(
        (c) => c.type === "position" && c.dragging === false,
      );
      let hist: Partial<Pick<BuilderState, "past" | "future">> = {};
      if (hasRemove) {
        hist = pushHistory(s);
      } else if (dragStart && !dragActive) {
        hist = pushHistory(s);
        dragActive = true;
      }
      if (dragEnd) dragActive = false;
      return { ...hist, nodes: applyNodeChanges(changes, s.nodes), dirty: true };
    }),

  onEdgesChange: (changes) =>
    set((s) => {
      if (s.readOnly) {
        const safe = changes.filter((c) => c.type === "select");
        return { edges: applyEdgeChanges(safe, s.edges) };
      }
      const hist = changes.some((c) => c.type === "remove")
        ? pushHistory(s)
        : {};
      return { ...hist, edges: applyEdgeChanges(changes, s.edges), dirty: true };
    }),

  onConnect: (connection) =>
    set((s) => {
      if (s.readOnly) return s;
      // A source handle may only fan out once: replace any existing edge from
      // the same source+handle so a digit can't point at two destinations.
      const filtered = s.edges.filter(
        (e) =>
          !(
            e.source === connection.source &&
            (e.sourceHandle ?? null) === (connection.sourceHandle ?? null)
          ),
      );
      return { ...pushHistory(s), edges: addEdge(connection, filtered), dirty: true };
    }),

  addNode: (kind, position) =>
    set((s) => {
      if (s.readOnly) return s;
      const node: IvrNode = {
        id: newNodeId(kind),
        type: kind,
        position: position ?? { x: 360, y: 80 + s.nodes.length * 40 },
        data: defaultNodeData(kind, s.extension),
      } as IvrNode;
      return { ...pushHistory(s), nodes: [...s.nodes, node], selectedNodeId: node.id, dirty: true };
    }),

  updateNodeData: (id, patch) =>
    set((s) => (s.readOnly ? s : {
      nodes: s.nodes.map((n) =>
        n.id === id
          ? ({ ...n, data: { ...n.data, ...patch } } as IvrNode)
          : n,
      ),
      dirty: true,
    })),

  removeNode: (id) =>
    set((s) => {
      if (s.readOnly) return s;
      const node = s.nodes.find((n) => n.id === id);
      // The start node is the flow entry and cannot be deleted.
      if (node?.type === "start") return s;
      return {
        ...pushHistory(s),
        nodes: s.nodes.filter((n) => n.id !== id),
        edges: s.edges.filter((e) => e.source !== id && e.target !== id),
        selectedNodeId: s.selectedNodeId === id ? null : s.selectedNodeId,
        dirty: true,
      };
    }),

  removeEdge: (id) =>
    set((s) => (s.readOnly ? s : { ...pushHistory(s), edges: s.edges.filter((e) => e.id !== id), dirty: true })),

  selectNode: (id) => set({ selectedNodeId: id }),

  copyNode: (id) =>
    set((s) => {
      const node = s.nodes.find((n) => n.id === id);
      if (!node || node.data.kind === "start") return s;
      return { clipboard: cloneNodeData(node.data) };
    }),

  cutNode: (id) => {
    const node = get().nodes.find((n) => n.id === id);
    if (!node || node.data.kind === "start") return;
    set({ clipboard: cloneNodeData(node.data) });
    get().removeNode(id);
  },

  pasteNode: (position) =>
    set((s) => {
      if (!s.clipboard || s.clipboard.kind === "start") return s;
      const data = cloneNodeData(s.clipboard);
      const id = newNodeId(data.kind);
      const node = {
        id,
        type: data.kind,
        position: position ?? { x: 380, y: 120 + s.nodes.length * 28 },
        data,
      } as IvrNode;
      return { ...pushHistory(s), nodes: [...s.nodes, node], selectedNodeId: id, dirty: true };
    }),

  duplicateNode: (id) =>
    set((s) => {
      const node = s.nodes.find((n) => n.id === id);
      if (!node || node.data.kind === "start") return s;
      const data = cloneNodeData(node.data);
      const newId = newNodeId(data.kind);
      const copy = {
        id: newId,
        type: data.kind,
        position: { x: node.position.x + 48, y: node.position.y + 48 },
        data,
      } as IvrNode;
      return { ...pushHistory(s), nodes: [...s.nodes, copy], selectedNodeId: newId, dirty: true };
    }),

  clearAll: () =>
    set((s) => {
      const start = s.nodes.find((n) => n.type === "start");
      return {
        ...pushHistory(s),
        nodes: start ? [start] : [],
        edges: [],
        selectedNodeId: null,
        dirty: true,
      };
    }),

  undo: () =>
    set((s) => {
      if (s.past.length === 0) return s;
      const previous = s.past[s.past.length - 1];
      return {
        past: s.past.slice(0, -1),
        future: [{ nodes: s.nodes, edges: s.edges }, ...s.future].slice(0, HISTORY_LIMIT),
        nodes: previous.nodes,
        edges: previous.edges,
        selectedNodeId: null,
        dirty: true,
      };
    }),

  redo: () =>
    set((s) => {
      if (s.future.length === 0) return s;
      const next = s.future[0];
      return {
        past: [...s.past, { nodes: s.nodes, edges: s.edges }].slice(-HISTORY_LIMIT),
        future: s.future.slice(1),
        nodes: next.nodes,
        edges: next.edges,
        selectedNodeId: null,
        dirty: true,
      };
    }),


  addMenuOption: (nodeId, digit) =>
    set((s) => ({
      ...pushHistory(s),
      nodes: s.nodes.map((n) => {
        if (n.id !== nodeId || n.data.kind !== "menu") return n;
        const data = n.data as MenuNodeData;
        const option = makeMenuOption(digit, "");
        const options = [...data.options, option];
        return {
          ...n,
          data: { ...data, options, validDigits: options.map((o) => o.digit).join("") },
        } as IvrNode;
      }),
      dirty: true,
    })),

  updateMenuOption: (nodeId, optionId, patch) =>
    set((s) => ({
      nodes: s.nodes.map((n) => {
        if (n.id !== nodeId || n.data.kind !== "menu") return n;
        const data = n.data as MenuNodeData;
        const options = data.options.map((o) =>
          o.id === optionId ? { ...o, ...patch } : o,
        );
        return {
          ...n,
          data: { ...data, options, validDigits: options.map((o) => o.digit).join("") },
        } as IvrNode;
      }),
      dirty: true,
    })),

  removeMenuOption: (nodeId, optionId) =>
    set((s) => ({
      ...pushHistory(s),
      nodes: s.nodes.map((n) => {
        if (n.id !== nodeId || n.data.kind !== "menu") return n;
        const data = n.data as MenuNodeData;
        const options = data.options.filter((o) => o.id !== optionId);
        return {
          ...n,
          data: { ...data, options, validDigits: options.map((o) => o.digit).join("") },
        } as IvrNode;
      }),
      // Drop any edge that left the removed option's handle.
      edges: s.edges.filter(
        (e) => !(e.source === nodeId && e.sourceHandle === optionId),
      ),
      dirty: true,
    })),

  getSelectedNode: () => {
    const s = get();
    return s.nodes.find((n) => n.id === s.selectedNodeId) ?? null;
  },
}));
