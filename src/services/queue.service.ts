import { EventEmitter } from 'events';

/**
 * Agent availability within a call queue.
 *  - offline:   not SIP-registered, so cannot take calls.
 *  - available: registered, idle, and not paused — eligible to be rung.
 *  - ringing:   currently being offered a waiting caller.
 *  - busy:      bridged to a caller from this queue.
 *  - paused:    registered but opted out (ACD "not ready"); skipped by routing.
 */
export type QueueAgentState = 'offline' | 'available' | 'ringing' | 'busy' | 'paused';

/** State of a caller waiting in (or connected through) a queue. */
export type QueueCallerState = 'waiting' | 'ringing' | 'connected';

/** Distribution order when more than one agent is available. */
export type QueueStrategy = 'longest-idle' | 'round-robin' | 'sequential';

export interface QueueAgent {
  extension: string;
  name: string;
  state: QueueAgentState;
  /** Whether the agent has opted out (ACD not-ready). Persists across presence. */
  paused: boolean;
  /** Epoch ms the agent last became idle (used by the longest-idle strategy). */
  idleSince: number;
  /** Number of queue calls this agent has handled since startup. */
  callsHandled: number;
}

export interface QueueCaller {
  /** The SIP callId — the queue's key for this caller. */
  id: string;
  from: string;
  fromName: string;
  enqueuedAt: number;
  state: QueueCallerState;
  /** Extension of the agent currently being rung / connected, if any. */
  agent?: string;
}

interface Queue {
  id: string;
  name: string;
  strategy: QueueStrategy;
  agents: Map<string, QueueAgent>;
  callers: Map<string, QueueCaller>;
  /** Cursor for round-robin, indexing into the agent roster order. */
  rrCursor: number;
}

/** Serializable agent shape pushed to clients over WebSocket. */
export interface QueueAgentSnapshot {
  extension: string;
  name: string;
  state: QueueAgentState;
  paused: boolean;
  callsHandled: number;
}

/** Serializable caller shape pushed to clients over WebSocket. */
export interface QueueCallerSnapshot {
  id: string;
  from: string;
  fromName: string;
  state: QueueCallerState;
  agent?: string;
  /** Seconds the caller has been waiting (at snapshot time). */
  waitingSecs: number;
}

/** Serializable queue snapshot pushed to clients over WebSocket. */
export interface QueueSnapshot {
  id: string;
  name: string;
  strategy: QueueStrategy;
  agents: QueueAgentSnapshot[];
  callers: QueueCallerSnapshot[];
  stats: {
    waiting: number;
    connected: number;
    agentsAvailable: number;
    agentsTotal: number;
    longestWaitSecs: number;
  };
}

export interface QueueDefinition {
  id: string;
  name: string;
  agents: string[];
  strategy: string;
}

/**
 * In-memory registry of call queues (ACD).
 *
 * Queues are declared up front (from config) with a fixed agent roster; this
 * service tracks which agents are currently available and which callers are
 * waiting, so the SIP path can pick the next agent to ring and the UI can show
 * a live supervisor view. The actual ringing/bridging happens on the SIP/media
 * layer (IVRSystem.enqueueCaller) — this is pure bookkeeping plus the agent
 * selection policy. A single instance is shared between the SIP server (writes
 * caller/agent state from the media path) and the signaling server (reads
 * snapshots, toggles agent pause, broadcasts updates).
 *
 * Emits:
 *  - 'updated' (queueId): the queue changed — re-broadcast its snapshot.
 */
export class QueueService extends EventEmitter {
  private queues = new Map<string, Queue>();
  /** Resolves whether an extension is currently SIP-registered (presence). */
  private isRegistered: (ext: string) => boolean = () => false;

  constructor(definitions: QueueDefinition[] = []) {
    super();
    for (const def of definitions) {
      const agents = new Map<string, QueueAgent>();
      for (const ext of def.agents) {
        agents.set(ext, {
          extension: ext,
          name: ext,
          state: 'offline',
          paused: false,
          idleSince: Date.now(),
          callsHandled: 0,
        });
      }
      this.queues.set(def.id, {
        id: def.id,
        name: def.name,
        strategy: this.normalizeStrategy(def.strategy),
        agents,
        callers: new Map(),
        rrCursor: 0,
      });
    }
  }

  private normalizeStrategy(s: string): QueueStrategy {
    return s === 'round-robin' || s === 'sequential' ? s : 'longest-idle';
  }

  /**
   * Supply a presence resolver (db.isRegistered) and optionally a name resolver
   * so agents show their display name. Recomputes offline/available for every
   * agent immediately.
   */
  setPresenceProvider(fn: (ext: string) => boolean, nameOf?: (ext: string) => string | undefined): void {
    this.isRegistered = fn;
    for (const queue of this.queues.values()) {
      for (const agent of queue.agents.values()) {
        if (nameOf) agent.name = nameOf(agent.extension) || agent.extension;
      }
      this.recomputePresence(queue);
    }
  }

  /**
   * Reconcile each agent's offline/available state with live presence, without
   * clobbering transient ringing/busy or an explicit pause. Called whenever a
   * registration changes.
   */
  syncPresence(): void {
    for (const queue of this.queues.values()) {
      if (this.recomputePresence(queue)) this.emit('updated', queue.id);
    }
  }

  private recomputePresence(queue: Queue): boolean {
    let changed = false;
    for (const agent of queue.agents.values()) {
      const online = this.isRegistered(agent.extension);
      let next = agent.state;
      if (!online) next = 'offline';
      else if (agent.paused) next = 'paused';
      // Don't override a live ringing/busy state from presence; only lift an
      // agent out of offline/paused back to available when they come online.
      else if (agent.state === 'offline' || agent.state === 'paused') next = 'available';
      if (next !== agent.state) {
        agent.state = next;
        if (next === 'available') agent.idleSince = Date.now();
        changed = true;
      }
    }
    return changed;
  }

  getQueue(id: string): Queue | undefined {
    return this.queues.get(id);
  }

  list(): Queue[] {
    return Array.from(this.queues.values());
  }

  /** Queue ids the given extension is an agent of. */
  queuesForAgent(ext: string): string[] {
    const ids: string[] = [];
    for (const queue of this.queues.values()) {
      if (queue.agents.has(ext)) ids.push(queue.id);
    }
    return ids;
  }

  // ─── Caller lifecycle (driven from the SIP/media path) ───────────────

  /** Add a caller to the queue's waiting list. */
  enqueue(queueId: string, callId: string, from: string, fromName: string): void {
    const queue = this.queues.get(queueId);
    if (!queue) return;
    queue.callers.set(callId, {
      id: callId,
      from,
      fromName: fromName || from,
      enqueuedAt: Date.now(),
      state: 'waiting',
    });
    this.emit('updated', queueId);
  }

  /** Mark the caller as ringing a specific agent (and the agent as ringing). */
  markCallerRinging(queueId: string, callId: string, agentExt: string): void {
    const queue = this.queues.get(queueId);
    const caller = queue?.callers.get(callId);
    if (!queue || !caller) return;
    caller.state = 'ringing';
    caller.agent = agentExt;
    const agent = queue.agents.get(agentExt);
    if (agent && (agent.state === 'available')) agent.state = 'ringing';
    this.emit('updated', queueId);
  }

  /** The agent declined / didn't answer: return the caller to waiting and the
   *  agent to available so routing can try the next one. */
  releaseRing(queueId: string, callId: string, agentExt: string): void {
    const queue = this.queues.get(queueId);
    if (!queue) return;
    const caller = queue.callers.get(callId);
    if (caller && caller.agent === agentExt) {
      caller.state = 'waiting';
      caller.agent = undefined;
    }
    const agent = queue.agents.get(agentExt);
    if (agent && agent.state === 'ringing') {
      agent.state = this.isRegistered(agentExt) ? (agent.paused ? 'paused' : 'available') : 'offline';
      agent.idleSince = Date.now();
    }
    this.emit('updated', queueId);
  }

  /** The caller is now bridged to the agent. */
  markCallerConnected(queueId: string, callId: string, agentExt: string): void {
    const queue = this.queues.get(queueId);
    const caller = queue?.callers.get(callId);
    if (!queue || !caller) return;
    caller.state = 'connected';
    caller.agent = agentExt;
    const agent = queue.agents.get(agentExt);
    if (agent) {
      agent.state = 'busy';
      agent.callsHandled += 1;
    }
    this.emit('updated', queueId);
  }

  /** Remove a caller from the queue and free the agent that served them. */
  dequeue(queueId: string, callId: string): void {
    const queue = this.queues.get(queueId);
    if (!queue) return;
    const caller = queue.callers.get(callId);
    if (!caller) return;
    queue.callers.delete(callId);
    if (caller.agent) {
      const agent = queue.agents.get(caller.agent);
      if (agent && (agent.state === 'busy' || agent.state === 'ringing')) {
        agent.state = this.isRegistered(agent.extension) ? (agent.paused ? 'paused' : 'available') : 'offline';
        agent.idleSince = Date.now();
      }
    }
    this.emit('updated', queueId);
  }

  // ─── Agent selection (the distribution policy) ───────────────────────

  /**
   * Pick the next agent to ring for a queue: a registered, non-paused agent
   * that is currently idle (available). Honours the queue's strategy:
   *  - longest-idle: the agent idle the longest (fairest spread).
   *  - round-robin:  next in roster order after the last one tried.
   *  - sequential:   always the first available in roster order.
   * `exclude` skips agents already tried for this caller in the current pass.
   * Returns undefined when no agent is available right now.
   */
  nextAvailableAgent(queueId: string, exclude: Set<string> = new Set()): QueueAgent | undefined {
    const queue = this.queues.get(queueId);
    if (!queue) return undefined;
    const candidates = Array.from(queue.agents.values()).filter(
      (a) => a.state === 'available' && !exclude.has(a.extension),
    );
    if (candidates.length === 0) return undefined;

    if (queue.strategy === 'longest-idle') {
      return candidates.reduce((best, a) => (a.idleSince < best.idleSince ? a : best));
    }
    if (queue.strategy === 'round-robin') {
      const roster = Array.from(queue.agents.keys());
      for (let i = 1; i <= roster.length; i++) {
        const ext = roster[(queue.rrCursor + i) % roster.length];
        const agent = queue.agents.get(ext);
        if (agent && agent.state === 'available' && !exclude.has(ext)) {
          queue.rrCursor = (queue.rrCursor + i) % roster.length;
          return agent;
        }
      }
      return candidates[0];
    }
    // sequential: first available in roster order
    return candidates[0];
  }

  // ─── Agent controls (driven from the signaling/WS path) ──────────────

  /** Set an agent's paused (ACD not-ready) flag for one queue. No-op if the
   *  extension isn't an agent of that queue. Returns true if it changed. */
  setAgentPaused(queueId: string, ext: string, paused: boolean): boolean {
    const queue = this.queues.get(queueId);
    const agent = queue?.agents.get(ext);
    if (!queue || !agent || agent.paused === paused) return false;
    agent.paused = paused;
    // Reflect immediately unless the agent is mid-call (busy/ringing stays).
    if (agent.state === 'available' || agent.state === 'paused' || agent.state === 'offline') {
      if (!this.isRegistered(ext)) agent.state = 'offline';
      else agent.state = paused ? 'paused' : 'available';
      if (agent.state === 'available') agent.idleSince = Date.now();
    }
    this.emit('updated', queueId);
    return true;
  }

  /** Toggle pause across every queue the agent belongs to. Returns affected ids. */
  setAgentPausedAll(ext: string, paused: boolean): string[] {
    const changed: string[] = [];
    for (const id of this.queuesForAgent(ext)) {
      if (this.setAgentPaused(id, ext, paused)) changed.push(id);
    }
    return changed;
  }

  // ─── Snapshots ───────────────────────────────────────────────────────

  snapshot(queueId: string): QueueSnapshot | undefined {
    const queue = this.queues.get(queueId);
    if (!queue) return undefined;
    const now = Date.now();
    const callers = Array.from(queue.callers.values()).map((c) => ({
      id: c.id,
      from: c.from,
      fromName: c.fromName,
      state: c.state,
      agent: c.agent,
      waitingSecs: Math.max(0, Math.round((now - c.enqueuedAt) / 1000)),
    }));
    const agents = Array.from(queue.agents.values()).map((a) => ({
      extension: a.extension,
      name: a.name,
      state: a.state,
      paused: a.paused,
      callsHandled: a.callsHandled,
    }));
    return {
      id: queue.id,
      name: queue.name,
      strategy: queue.strategy,
      agents,
      callers,
      stats: {
        waiting: callers.filter((c) => c.state !== 'connected').length,
        connected: callers.filter((c) => c.state === 'connected').length,
        agentsAvailable: agents.filter((a) => a.state === 'available').length,
        agentsTotal: agents.length,
        longestWaitSecs: callers
          .filter((c) => c.state !== 'connected')
          .reduce((max, c) => Math.max(max, c.waitingSecs), 0),
      },
    };
  }

  /** All queue snapshots (for an initial dashboard paint). */
  snapshotAll(): QueueSnapshot[] {
    return Array.from(this.queues.keys())
      .map((id) => this.snapshot(id))
      .filter((s): s is QueueSnapshot => !!s);
  }
}
