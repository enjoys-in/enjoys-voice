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

// ─── factory: a brand-new flow with a single start node ─

export function createEmptyFlow(name: string, extension: string): IvrFlow {
  const now = new Date().toISOString();
  const start: IvrNode = {
    id: newNodeId("start"),
    type: "start",
    position: { x: 80, y: 200 },
    data: defaultNodeData("start", extension),
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
  dirty: boolean;
  saving: boolean;

  // lifecycle
  loadFlow: (flow: IvrFlow) => void;
  startNewFlow: (name: string, extension: string) => void;
  save: () => Promise<IvrFlow | null>;
  reset: () => void;

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
  selectNode: (id: string | null) => void;

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
  dirty: false,
  saving: false,

  loadFlow: (flow) =>
    set({
      flowId: flow.id,
      name: flow.name,
      extension: flow.extension,
      enabled: flow.enabled,
      nodes: flow.nodes,
      edges: flow.edges,
      selectedNodeId: null,
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
      dirty: true,
    });
  },

  save: async () => {
    const s = get();
    if (!s.flowId) return null;
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
      dirty: false,
      saving: false,
    }),

  setMeta: (patch) => set((s) => ({ ...s, ...patch, dirty: true })),

  onNodesChange: (changes) =>
    set((s) => ({ nodes: applyNodeChanges(changes, s.nodes), dirty: true })),

  onEdgesChange: (changes) =>
    set((s) => ({ edges: applyEdgeChanges(changes, s.edges), dirty: true })),

  onConnect: (connection) =>
    set((s) => {
      // A source handle may only fan out once: replace any existing edge from
      // the same source+handle so a digit can't point at two destinations.
      const filtered = s.edges.filter(
        (e) =>
          !(
            e.source === connection.source &&
            (e.sourceHandle ?? null) === (connection.sourceHandle ?? null)
          ),
      );
      return { edges: addEdge(connection, filtered), dirty: true };
    }),

  addNode: (kind, position) =>
    set((s) => {
      const node: IvrNode = {
        id: newNodeId(kind),
        type: kind,
        position: position ?? { x: 360, y: 80 + s.nodes.length * 40 },
        data: defaultNodeData(kind, s.extension),
      } as IvrNode;
      return { nodes: [...s.nodes, node], selectedNodeId: node.id, dirty: true };
    }),

  updateNodeData: (id, patch) =>
    set((s) => ({
      nodes: s.nodes.map((n) =>
        n.id === id
          ? ({ ...n, data: { ...n.data, ...patch } } as IvrNode)
          : n,
      ),
      dirty: true,
    })),

  removeNode: (id) =>
    set((s) => {
      const node = s.nodes.find((n) => n.id === id);
      // The start node is the flow entry and cannot be deleted.
      if (node?.type === "start") return s;
      return {
        nodes: s.nodes.filter((n) => n.id !== id),
        edges: s.edges.filter((e) => e.source !== id && e.target !== id),
        selectedNodeId: s.selectedNodeId === id ? null : s.selectedNodeId,
        dirty: true,
      };
    }),

  selectNode: (id) => set({ selectedNodeId: id }),

  addMenuOption: (nodeId, digit) =>
    set((s) => ({
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
