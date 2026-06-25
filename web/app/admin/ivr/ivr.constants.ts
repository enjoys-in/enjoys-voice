/**
 * IVR builder — static metadata & node factory defaults.
 *
 * Keeps presentation concerns (labels, icons, colors) and the "new node" seed
 * shapes in one place so the palette, canvas and inspector stay consistent.
 */
import {
  PhoneIncoming,
  ListTree,
  Volume2,
  GitBranch,
  PhoneForwarded,
  Voicemail,
  Mail,
  Bot,
  PhoneOff,
  type LucideIcon,
} from "lucide-react";

import {
  emptyPrompt,
  type ConditionOperator,
  type ConditionVariable,
  type DtmfDigit,
  type IvrNodeData,
  type IvrNodeKind,
  type MenuOption,
} from "./ivr.types";

// ─── Palette metadata ───────────────────────────────────

export type NodeMeta = {
  kind: IvrNodeKind;
  title: string;
  description: string;
  icon: LucideIcon;
  /** Tailwind classes for the node accent (border/badge). */
  accent: string;
  /** Whether the user may add this from the palette (start is auto-created). */
  addable: boolean;
  /** Flags a preview/experimental block (shown with an “experimental” badge). */
  experimental?: boolean;
};

export const NODE_META: Record<IvrNodeKind, NodeMeta> = {
  start: {
    kind: "start",
    title: "Start",
    description: "Entry point — the extension that triggers this flow.",
    icon: PhoneIncoming,
    accent: "text-emerald-500 border-emerald-500/40",
    addable: false,
  },
  menu: {
    kind: "menu",
    title: "Menu",
    description: "Play a prompt and route by the digit the caller presses.",
    icon: ListTree,
    accent: "text-sky-500 border-sky-500/40",
    addable: true,
  },
  play: {
    kind: "play",
    title: "Play message",
    description: "Speak text or play an audio file, then continue.",
    icon: Volume2,
    accent: "text-violet-500 border-violet-500/40",
    addable: true,
  },
  condition: {
    kind: "condition",
    title: "Condition",
    description: "Branch if/else by matching a value (caller id, time, digits…).",
    icon: GitBranch,
    accent: "text-indigo-500 border-indigo-500/40",
    addable: true,
  },
  transfer: {
    kind: "transfer",
    title: "Transfer",
    description: "Ring a department or extension.",
    icon: PhoneForwarded,
    accent: "text-amber-500 border-amber-500/40",
    addable: true,
  },
  voicemail: {
    kind: "voicemail",
    title: "Voicemail",
    description: "Record a message to a mailbox.",
    icon: Voicemail,
    accent: "text-pink-500 border-pink-500/40",
    addable: true,
  },
  email: {
    kind: "email",
    title: "Send email",
    description: "Trigger an email via a connector (subject, body, to).",
    icon: Mail,
    accent: "text-teal-500 border-teal-500/40",
    addable: true,
    experimental: true,
  },
  ai_agent: {
    kind: "ai_agent",
    title: "AI agent",
    description: "Hand the call to an AI voice agent that talks with the caller.",
    icon: Bot,
    accent: "text-cyan-500 border-cyan-500/40",
    addable: true,
  },
  hangup: {
    kind: "hangup",
    title: "Hang up",
    description: "End the call.",
    icon: PhoneOff,
    accent: "text-rose-500 border-rose-500/40",
    addable: true,
  },
};

/** Palette order (start excluded — it is created with the flow). */
export const PALETTE_KINDS: IvrNodeKind[] = [
  "menu",
  "play",
  "condition",
  "transfer",
  "voicemail",
  "email",
  "ai_agent",
  "hangup",
];

// ─── Condition labels (display) ─────────────────────

export const VARIABLE_LABELS: Record<ConditionVariable, string> = {
  caller_id: "Caller ID",
  dialed_number: "Dialed number",
  last_digit: "Last digit",
  digits: "Collected digits",
  time_of_day: "Time of day",
  day_of_week: "Day of week",
  custom: "Custom variable",
};

export const OPERATOR_LABELS: Record<ConditionOperator, string> = {
  eq: "equals",
  neq: "not equals",
  contains: "contains",
  starts_with: "starts with",
  ends_with: "ends with",
  regex: "matches regex",
  in_range: "in range",
};

// ─── Defaults ───────────────────────────────────────────

export const DEFAULT_TRIES = 2;
export const DEFAULT_TIMEOUT_MS = 7000;
export const DEFAULT_RING_SECONDS = 30;
export const DEFAULT_VOICEMAIL_MAX_SECONDS = 120;

let optionSeq = 0;
export function makeMenuOption(digit: DtmfDigit, label = ""): MenuOption {
  optionSeq += 1;
  return { id: `opt_${Date.now().toString(36)}_${optionSeq}`, digit, label };
}

/**
 * Seed data for a freshly-dropped node of the given kind. The `start` kind is
 * only created once per flow (by the store) and carries the flow's extension.
 */
export function defaultNodeData(kind: IvrNodeKind, extension = ""): IvrNodeData {
  switch (kind) {
    case "start":
      return {
        kind: "start",
        label: "Start",
        extension,
        greeting: emptyPrompt("Welcome to Enjoys Voice."),
      };
    case "menu":
      return {
        kind: "menu",
        label: "Main menu",
        prompt: emptyPrompt("Press 1 for Sales. Press 2 for Support."),
        validDigits: "12",
        tries: DEFAULT_TRIES,
        timeoutMs: DEFAULT_TIMEOUT_MS,
        options: [makeMenuOption("1", "Sales"), makeMenuOption("2", "Support")],
      };
    case "play":
      return {
        kind: "play",
        label: "Play message",
        prompt: emptyPrompt("Thank you for calling."),
        bargeIn: true,
      };
    case "condition":
      return {
        kind: "condition",
        label: "Condition",
        variable: "caller_id",
        operator: "contains",
        value: "",
        ignoreCase: true,
      };
    case "transfer":
      return {
        kind: "transfer",
        label: "Transfer",
        attended: false,
        ringSeconds: DEFAULT_RING_SECONDS,
      };
    case "voicemail":
      return {
        kind: "voicemail",
        label: "Voicemail",
        maxSeconds: DEFAULT_VOICEMAIL_MAX_SECONDS,
        greeting: emptyPrompt("Please leave a message after the tone."),
      };
    case "email":
      return {
        kind: "email",
        label: "Send email",
        connectorId: "",
        to: "",
        subject: "New IVR call",
        body: "A caller reached this step in the IVR flow.",
      };
    case "ai_agent":
      return {
        kind: "ai_agent",
        label: "AI agent",
        agentId: "",
      };
    case "hangup":
      return { kind: "hangup", label: "Hang up" };
  }
}
