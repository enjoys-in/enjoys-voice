/**
 * IVR flow — RUNTIME types.
 *
 * These mirror the builder's domain types (web/app/admin/ivr/ivr.types.ts) but
 * are deliberately decoupled and lenient: the graph is read back from the shared
 * Postgres `ivr_flows.graph` JSONB column (written by the Go API), so every field
 * is treated as untrusted input. The interpreter (flow-runner.ts) walks this
 * shape at call time.
 *
 * The stored graph is `{ nodes: ReactFlowNode[], edges: ReactFlowEdge[] }` where
 * each node is `{ id, type, position, data:{ kind, … } }` and each edge is
 * `{ id, source, target, sourceHandle?, targetHandle? }`. A menu option owns a
 * source handle whose id equals the edge's `sourceHandle`, encoding
 * "press <digit> → go to <target>".
 */

export type IvrNodeKind =
  | 'start'
  | 'menu'
  | 'play'
  | 'condition'
  | 'transfer'
  | 'voicemail'
  | 'hangup';

/** What the caller hears: synthesized speech or a pre-uploaded audio file. */
export interface Prompt {
  mode: 'tts' | 'audio';
  /** Spoken text when mode = "tts". */
  text?: string;
  /** Uploaded file name (bare, no path) when mode = "audio". */
  audioFile?: string;
}

/** One menu choice. `id` is the React Flow source-handle = the edge sourceHandle. */
export interface MenuOption {
  id: string;
  digit: string;
  label?: string;
}

export interface StartNodeData {
  kind: 'start';
  label?: string;
  extension?: string;
  greeting?: Prompt;
}

export interface MenuNodeData {
  kind: 'menu';
  label?: string;
  prompt?: Prompt;
  /** Digits accepted, e.g. "1239". */
  validDigits?: string;
  tries?: number;
  timeoutMs?: number;
  invalidPrompt?: Prompt;
  options?: MenuOption[];
}

export interface PlayNodeData {
  kind: 'play';
  label?: string;
  prompt?: Prompt;
  bargeIn?: boolean;
}

export type ConditionVariable =
  | 'caller_id'
  | 'dialed_number'
  | 'last_digit'
  | 'digits'
  | 'time_of_day'
  | 'day_of_week'
  | 'custom';

export type ConditionOperator =
  | 'eq'
  | 'neq'
  | 'contains'
  | 'starts_with'
  | 'ends_with'
  | 'regex'
  | 'in_range';

export interface ConditionNodeData {
  kind: 'condition';
  label?: string;
  variable: ConditionVariable;
  customVariable?: string;
  operator: ConditionOperator;
  value: string;
  ignoreCase?: boolean;
}

export interface TransferNodeData {
  kind: 'transfer';
  label?: string;
  department?: string;
  extension?: string;
  attended?: boolean;
  ringSeconds?: number;
}

export interface VoicemailNodeData {
  kind: 'voicemail';
  label?: string;
  mailbox?: string;
  maxSeconds?: number;
  greeting?: Prompt;
}

export interface HangupNodeData {
  kind: 'hangup';
  label?: string;
}

export type IvrNodeData =
  | StartNodeData
  | MenuNodeData
  | PlayNodeData
  | ConditionNodeData
  | TransferNodeData
  | VoicemailNodeData
  | HangupNodeData;

/** A graph node as persisted (React Flow shape — only the fields we need). */
export interface IvrGraphNode {
  id: string;
  type?: string;
  data: IvrNodeData;
}

/** A graph edge as persisted. `sourceHandle` carries the menu-option / branch id. */
export interface IvrGraphEdge {
  id?: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

/** A complete, runnable flow loaded from `ivr_flows`. */
export interface IvrFlowGraph {
  id: string;
  name: string;
  extension: string;
  enabled: boolean;
  nodes: IvrGraphNode[];
  edges: IvrGraphEdge[];
}
