/**
 * IVR flow INTERPRETER.
 *
 * Walks an `IvrFlowGraph` (loaded from the shared `ivr_flows` table) at call
 * time: starts at the `start` node, plays each node's prompt, collects DTMF,
 * follows the matching edge, and runs terminal actions. All media I/O is done
 * through the injected `FlowRunnerHandlers` so this module stays free of any
 * FreeSWITCH/Mrf coupling and the branch-resolution + condition logic remain
 * pure and unit-testable.
 *
 * Edge resolution:
 *   • menu      → pressed digit → matching option.id → edge whose
 *                 sourceHandle === option.id → target
 *   • condition → "true" / "false" branch (sourceHandle), else 1st/2nd out-edge
 *   • others    → the single out-edge
 */
import { config } from '@/core';
import type {
  ConditionNodeData,
  IvrFlowGraph,
  IvrGraphEdge,
  IvrGraphNode,
  MenuNodeData,
  PlayNodeData,
  Prompt,
  StartNodeData,
  TransferNodeData,
  VoicemailNodeData,
} from './flow.types';

/** Per-call context handed to the interpreter (read-only channel facts). */
export interface FlowRunnerContext {
  callId: string;
  callerNumber: string;
  /** The dialed DID/extension that selected this flow. */
  dialedNumber: string;
}

/** Media primitives the interpreter needs, supplied by the IVR system. */
export interface FlowRunnerHandlers {
  /** Play a file / `say:` / stream URI, tolerating a missing file. */
  play(file: string): Promise<void>;
  /** Play a prompt and collect ONE DTMF digit (barge-in); '' on no/invalid input. */
  collect(
    prompt: string,
    opts: { valid?: string; tries?: number; waitMs?: number; label?: string },
  ): Promise<string>;
  /** Record a voicemail on the already-connected endpoint. */
  voicemail(mailbox: string, opts: { greeting?: string; maxSeconds?: number }): Promise<void>;
  /** Route the caller to a department queue and/or a specific extension. */
  transfer(opts: { department?: string; extension?: string; ringSeconds?: number }): Promise<void>;
}

export type FlowResult =
  | 'completed'
  | 'voicemail'
  | 'transferred'
  | 'hangup'
  | 'error';

/** Hard ceiling on node hops so a mis-wired (cyclic) graph can never loop forever. */
const MAX_HOPS = 50;
/** Bare-filename guard for user-uploaded audio (no path separators / traversal). */
const SAFE_AUDIO_FILE = /^[A-Za-z0-9._-]+$/;

// ─── Pure graph helpers (exported for tests) ─────────────────────────────

export function findStart(nodes: IvrGraphNode[]): IvrGraphNode | undefined {
  return nodes.find((n) => nodeKind(n) === 'start');
}

export function nodeKind(node: IvrGraphNode): string | undefined {
  return node?.data?.kind ?? node?.type;
}

/** First edge leaving `nodeId` (optionally filtered by sourceHandle). */
export function edgeFrom(
  edges: IvrGraphEdge[],
  nodeId: string,
  handle?: string,
): IvrGraphEdge | undefined {
  return edges.find(
    (e) => e.source === nodeId && (handle === undefined || (e.sourceHandle ?? undefined) === handle),
  );
}

/** Resolve the destination node id for a pressed menu digit. */
export function resolveMenuTarget(
  menu: MenuNodeData,
  edges: IvrGraphEdge[],
  nodeId: string,
  digit: string,
): string | undefined {
  const option = (menu.options ?? []).find((o) => o.digit === digit);
  if (!option) return undefined;
  return edgeFrom(edges, nodeId, option.id)?.target;
}

/** Evaluate a condition node against the live channel facts. Pure. */
export function evaluateCondition(
  data: ConditionNodeData,
  facts: { callerId: string; dialedNumber: string; lastDigit: string; digits: string },
  now: Date = new Date(),
): boolean {
  let subject = '';
  switch (data.variable) {
    case 'caller_id': subject = facts.callerId; break;
    case 'dialed_number': subject = facts.dialedNumber; break;
    case 'last_digit': subject = facts.lastDigit; break;
    case 'digits': subject = facts.digits; break;
    case 'time_of_day': subject = String(now.getHours()); break;
    case 'day_of_week': subject = String(now.getDay()); break;
    case 'custom': return false; // custom channel vars aren't available here
    default: return false;
  }

  const target = data.value ?? '';
  const ci = data.ignoreCase ?? false;
  const a = ci ? subject.toLowerCase() : subject;
  const b = ci ? target.toLowerCase() : target;

  switch (data.operator) {
    case 'eq': return a === b;
    case 'neq': return a !== b;
    case 'contains': return a.includes(b);
    case 'starts_with': return a.startsWith(b);
    case 'ends_with': return a.endsWith(b);
    case 'regex':
      try { return new RegExp(target, ci ? 'i' : '').test(subject); }
      catch { return false; }
    case 'in_range': {
      const [min, max] = target.split(',').map((s) => Number(s.trim()));
      const n = Number(subject);
      return Number.isFinite(n) && Number.isFinite(min) && Number.isFinite(max)
        && n >= min && n <= max;
    }
    default: return false;
  }
}

/**
 * Render a prompt to a single play()-able string, or null if unplayable.
 * TTS → `say:<text>` (uses the channel's tts engine/voice).
 * Audio → absolute path under the FreeSWITCH-shared IVR sounds dir, with a
 * strict bare-filename check to prevent path traversal on user uploads.
 */
export function renderPrompt(prompt?: Prompt): string | null {
  if (!prompt) return null;
  if (prompt.mode === 'audio') {
    const file = (prompt.audioFile ?? '').trim();
    if (!file || !SAFE_AUDIO_FILE.test(file)) return null;
    return `${config.sounds.basePath.replace(/\/$/, '')}/ivr/${file}`;
  }
  const text = (prompt.text ?? '').trim();
  return text ? `say:${text}` : null;
}

// ─── Interpreter ─────────────────────────────────────────────────────────

/**
 * Execute a flow against a connected caller. Returns how the flow ended so the
 * caller can update call state. Never throws for normal media errors — a missing
 * prompt or a dead-end edge ends the flow gracefully.
 */
export async function runFlow(
  flow: IvrFlowGraph,
  ctx: FlowRunnerContext,
  h: FlowRunnerHandlers,
): Promise<FlowResult> {
  const byId = new Map<string, IvrGraphNode>(flow.nodes.map((n) => [n.id, n]));
  const start = findStart(flow.nodes);
  if (!start) {
    console.warn(`⚠️ IVR flow "${flow.name}" has no start node [${ctx.callId}]`);
    return 'error';
  }

  let lastDigit = '';
  let digits = '';
  let current: IvrGraphNode | undefined = start;

  for (let hop = 0; hop < MAX_HOPS && current; hop++) {
    const node = current;
    const kind = nodeKind(node);
    console.log(`   🔢 IVR flow: ${kind} [${node.id}] (hop ${hop + 1}) [${ctx.callId}]`);

    switch (kind) {
      case 'start': {
        const greeting = renderPrompt((node.data as StartNodeData).greeting);
        if (greeting) await h.play(greeting);
        current = byId.get(edgeFrom(flow.edges, node.id)?.target ?? '');
        break;
      }

      case 'play': {
        const data = node.data as PlayNodeData;
        const prompt = renderPrompt(data.prompt);
        if (prompt) await h.play(prompt);
        current = byId.get(edgeFrom(flow.edges, node.id)?.target ?? '');
        break;
      }

      case 'menu': {
        const data = node.data as MenuNodeData;
        const prompt = renderPrompt(data.prompt) ?? 'say:Please make a selection.';
        const valid = (data.validDigits && data.validDigits.length)
          ? data.validDigits
          : (data.options ?? []).map((o) => o.digit).join('');
        const digit = await h.collect(prompt, {
          valid,
          tries: data.tries ?? 2,
          waitMs: data.timeoutMs ?? 7000,
          label: 'menu',
        });

        if (digit) {
          lastDigit = digit;
          digits += digit;
          const target = resolveMenuTarget(data, flow.edges, node.id, digit);
          if (target) { current = byId.get(target); break; }
        }

        // No/invalid input: play the invalid prompt then take a default edge
        // (an edge with no sourceHandle), else end the flow.
        const invalid = renderPrompt(data.invalidPrompt);
        if (invalid) await h.play(invalid);
        const fallback = edgeFrom(flow.edges, node.id, undefined);
        current = fallback ? byId.get(fallback.target) : undefined;
        break;
      }

      case 'condition': {
        const data = node.data as ConditionNodeData;
        const truthy = evaluateCondition(data, {
          callerId: ctx.callerNumber,
          dialedNumber: ctx.dialedNumber,
          lastDigit,
          digits,
        });
        const branch = truthy ? 'true' : 'false';
        const outs = flow.edges.filter((e) => e.source === node.id);
        const handled = outs.find((e) => (e.sourceHandle ?? '') === branch);
        // Fall back to positional out-edges (1st = true, 2nd = false) when the
        // builder didn't label the handles.
        const chosen = handled ?? outs[truthy ? 0 : 1] ?? outs[0];
        current = chosen ? byId.get(chosen.target) : undefined;
        break;
      }

      case 'transfer': {
        const data = node.data as TransferNodeData;
        await h.transfer({
          department: data.department,
          extension: data.extension,
          ringSeconds: data.ringSeconds,
        });
        return 'transferred';
      }

      case 'voicemail': {
        const data = node.data as VoicemailNodeData;
        const mailbox = (data.mailbox && data.mailbox.trim()) || ctx.dialedNumber;
        await h.voicemail(mailbox, {
          greeting: renderPrompt(data.greeting) ?? undefined,
          maxSeconds: data.maxSeconds,
        });
        return 'voicemail';
      }

      case 'hangup':
        return 'hangup';

      default:
        console.warn(`⚠️ IVR flow: unknown node kind "${kind}" [${node.id}] [${ctx.callId}]`);
        return 'error';
    }
  }

  if (current) {
    console.warn(`⚠️ IVR flow "${flow.name}" exceeded ${MAX_HOPS} hops [${ctx.callId}]`);
    return 'error';
  }
  return 'completed';
}
