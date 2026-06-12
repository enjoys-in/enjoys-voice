/**
 * IVR flow builder — domain types.
 *
 * A flow is a directed graph the IVR runtime walks at call time:
 *   start → (play | menu) → menu branches per DTMF digit → transfer / voicemail / hangup
 *
 * These types are the single source of truth shared by the builder UI and the
 * persistence layer. They map cleanly onto a Postgres `ivr_flows` row where the
 * `{ nodes, edges }` graph is stored as a JSONB column (see ivr.api.ts).
 *
 * NOTE: node-data shapes are declared as `type` aliases (not `interface`) on
 * purpose — React Flow v12's `Node<T>` constrains `T extends Record<string,
 * unknown>`, which interfaces do not satisfy (no implicit index signature) but
 * closed object type aliases do.
 */
import type { Node, Edge } from "@xyflow/react";

// ─── DTMF ───────────────────────────────────────────────

export const DTMF_DIGITS = [
  "1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "*", "#",
] as const;

export type DtmfDigit = (typeof DTMF_DIGITS)[number];

// ─── Node kinds ─────────────────────────────────────────

export const IVR_NODE_KINDS = [
  "start",
  "menu",
  "play",
  "condition",
  "transfer",
  "voicemail",
  "hangup",
] as const;

export type IvrNodeKind = (typeof IVR_NODE_KINDS)[number];

// ─── Condition (if / else matching) ─────────────────────

/** Channel value a condition node can test against. */
export const CONDITION_VARIABLES = [
  "caller_id",
  "dialed_number",
  "last_digit",
  "digits",
  "time_of_day",
  "day_of_week",
  "custom",
] as const;

export type ConditionVariable = (typeof CONDITION_VARIABLES)[number];

/** How the variable is compared to the target value. */
export const CONDITION_OPERATORS = [
  "eq",
  "neq",
  "contains",
  "starts_with",
  "ends_with",
  "regex",
  "in_range",
] as const;

export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

// ─── Prompt (what the caller hears) ─────────────────────

/**
 * A prompt is either synthesized speech (TTS) or a pre-recorded/uploaded audio
 * file. `audioFile` is the file name served by the API at `/sounds/<file>` and
 * written into the FreeSWITCH-mounted sounds tree at play time.
 */
export type Prompt = {
  mode: "tts" | "audio";
  /** Spoken text when mode = "tts". */
  text?: string;
  /** Uploaded file name when mode = "audio". */
  audioFile?: string;
};

export function emptyPrompt(text = ""): Prompt {
  return { mode: "tts", text };
}

// ─── Menu options (digit → branch) ──────────────────────

/**
 * One selectable option on a menu node. Each option owns a React Flow source
 * handle (`id`) so the edge drawn from it encodes "press <digit> → go to the
 * connected node".
 */
export type MenuOption = {
  /** Stable handle id (also the edge sourceHandle). */
  id: string;
  /** Key the caller presses. */
  digit: DtmfDigit;
  /** Human label shown in the UI (e.g. "Sales"). */
  label: string;
};

// ─── Per-kind node data ─────────────────────────────────

export type StartNodeData = {
  kind: "start";
  label: string;
  /** DID / extension that enters this flow. */
  extension: string;
  /** Optional welcome message played once before the first node. */
  greeting: Prompt;
};

export type MenuNodeData = {
  kind: "menu";
  label: string;
  /** The "text to say" prompt played to the caller. */
  prompt: Prompt;
  /** Digits accepted, e.g. "1239". Derived from options but kept editable. */
  validDigits: string;
  /** How many times to replay the prompt when no/invalid input. */
  tries: number;
  /** How long to wait for a key after the prompt finishes (ms). */
  timeoutMs: number;
  /** Optional prompt played on invalid input. */
  invalidPrompt?: Prompt;
  /** Digit → branch options (each owns a source handle). */
  options: MenuOption[];
};

export type PlayNodeData = {
  kind: "play";
  label: string;
  prompt: Prompt;
  /** Allow the caller to interrupt playback by pressing a key. */
  bargeIn: boolean;
};

export type ConditionNodeData = {
  kind: "condition";
  label: string;
  /** Which channel value to test. */
  variable: ConditionVariable;
  /** Channel variable name when `variable` = "custom" (e.g. "vip_caller"). */
  customVariable?: string;
  /** Comparison operator. */
  operator: ConditionOperator;
  /** Target value. For `in_range` use "min,max"; for `regex` a pattern. */
  value: string;
  /** Case-insensitive string comparison. */
  ignoreCase: boolean;
};

export type TransferNodeData = {
  kind: "transfer";
  label: string;
  /** Department id to route to (optional). */
  department?: string;
  /** Specific extension to ring (optional). */
  extension?: string;
  /** Attended (consultative) vs blind transfer. */
  attended: boolean;
  /** Ring timeout before falling through (seconds). */
  ringSeconds: number;
};

export type VoicemailNodeData = {
  kind: "voicemail";
  label: string;
  /** Mailbox owner; defaults to the called extension when empty. */
  mailbox?: string;
  /** Maximum recording length (seconds). */
  maxSeconds: number;
  /** Greeting played before the beep. */
  greeting: Prompt;
};

export type HangupNodeData = {
  kind: "hangup";
  label: string;
};

export type IvrNodeData =
  | StartNodeData
  | MenuNodeData
  | PlayNodeData
  | ConditionNodeData
  | TransferNodeData
  | VoicemailNodeData
  | HangupNodeData;

// ─── React Flow node/edge aliases ───────────────────────

export type StartNode = Node<StartNodeData, "start">;
export type MenuNode = Node<MenuNodeData, "menu">;
export type PlayNode = Node<PlayNodeData, "play">;
export type ConditionNode = Node<ConditionNodeData, "condition">;
export type TransferNode = Node<TransferNodeData, "transfer">;
export type VoicemailNode = Node<VoicemailNodeData, "voicemail">;
export type HangupNode = Node<HangupNodeData, "hangup">;

export type IvrNode =
  | StartNode
  | MenuNode
  | PlayNode
  | ConditionNode
  | TransferNode
  | VoicemailNode
  | HangupNode;

export type IvrEdge = Edge;

// ─── Flow (one IVR "agent") ─────────────────────────────

/**
 * A complete IVR flow ("agent"). `extension` is the entry DID that triggers it.
 * Persisted as one row; `{ nodes, edges }` becomes a JSONB graph column.
 */
export type IvrFlow = {
  id: string;
  name: string;
  extension: string;
  enabled: boolean;
  nodes: IvrNode[];
  edges: IvrEdge[];
  createdAt: string;
  updatedAt: string;
};

/** Lightweight row for list views (no graph payload). */
export type IvrFlowSummary = Pick<
  IvrFlow,
  "id" | "name" | "extension" | "enabled" | "createdAt" | "updatedAt"
> & { nodeCount: number };
