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
  PhoneForwarded,
  Voicemail,
  PhoneOff,
  type LucideIcon,
} from "lucide-react";

import {
  emptyPrompt,
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
  "transfer",
  "voicemail",
  "hangup",
];

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
    case "hangup":
      return { kind: "hangup", label: "Hang up" };
  }
}
