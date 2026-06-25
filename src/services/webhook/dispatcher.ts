import {
  DbEvent,
  WriteJob,
  type CallLog,
  type WebhookCallSnapshot,
  type WebhookDeliverJob,
  type WebhookEventPayload,
} from '@/core';
import type { DatabaseService } from '../database.service';
import type { AuditService, AuditEntry } from '../audit.service';

/** Map a call's terminal/lifecycle status to the canonical webhook event name.
 * Statuses without a mapping (none currently) fire nothing. */
const STATUS_EVENT: Record<CallLog['status'], string> = {
  ringing: 'call.ringing',
  answered: 'call.answered',
  ended: 'call.completed',
  missed: 'call.missed',
  failed: 'call.failed',
  unreachable: 'call.unreachable',
  voicemail: 'call.voicemail',
};

/** Map an audit event to a webhook event for the non-status transitions
 * (routing + transfer/forward) that don't surface as a call status. */
const AUDIT_EVENT: Record<string, string> = {
  call_routed: 'call.routed',
  call_forwarded: 'call.transferred',
  trunk_call_forwarded: 'call.transferred',
};

/** Bound the de-dupe set so a long-running process can't leak memory. When it
 * fills, the oldest keys are evicted (FIFO via Map insertion order). */
const MAX_SEEN = 10_000;

export interface WebhookDispatcherDeps {
  db: DatabaseService;
  /** Audit feed tapped for routing/transfer events that aren't a call status. */
  audit: AuditService;
  /** Enqueue a job on the write-behind queue (passed in to avoid a module cycle). */
  enqueue: (type: string, payload: unknown) => Promise<void>;
}

/**
 * Fires users' per-user webhooks on call events. It taps the single choke point
 * every call mutation already flows through — DatabaseService's `CallUpserted`
 * event — maps the call's status to a canonical event, and enqueues a signed
 * delivery for each of the involved owners' matching webhooks. Two events that
 * aren't a status transition (`call.routed`, `call.transferred`) are sourced
 * from the audit feed instead. Delivery itself rides the Redis write-behind
 * queue, so the SIP/call path is never blocked by a slow receiver.
 *
 * Idempotency: each (call, event) is dispatched at most once (updateCall can be
 * called repeatedly with the same status), and every delivery body carries a
 * stable `idempotencyKey` of `<webhookId>:<callId>:<event>` so receivers can
 * de-duplicate retries too.
 *
 * Scope: a webhook fires for any call its owner is a party to — inbound to them
 * (toExt) or outbound from them (fromExt).
 */
export class WebhookDispatcher {
  private readonly db: DatabaseService;
  private readonly audit: AuditService;
  private readonly enqueue: (type: string, payload: unknown) => Promise<void>;
  /** Seen `<callId>:<event>` keys → insertion order for FIFO eviction. */
  private readonly seen = new Map<string, true>();

  constructor(deps: WebhookDispatcherDeps) {
    this.db = deps.db;
    this.audit = deps.audit;
    this.enqueue = deps.enqueue;
  }

  /** Subscribe to call mutations + the audit feed. Call once at startup. */
  attach(): void {
    this.db.on(DbEvent.CallUpserted, (call: CallLog) => {
      const event = STATUS_EVENT[call.status];
      if (event) void this.dispatch(event, call);
    });
    this.audit.on('entry', (e: AuditEntry) => this.onAuditEntry(e));
  }

  /**
   * Translate a routing/transfer audit entry into a webhook event. The full call
   * (with resolved owner extensions) is preferred when it's already logged;
   * otherwise a minimal snapshot is synthesized from the audit metadata and the
   * owners are resolved from the from/to legs.
   */
  private onAuditEntry(e: AuditEntry): void {
    const event = AUDIT_EVENT[e.event];
    if (!event) return;
    const md = e.metadata ?? {};
    const callId: string | undefined = md.callId;
    if (!callId) return;
    const existing = this.db.getCall(callId);
    const call: CallLog =
      existing ?? {
        id: callId,
        from: e.extension || md.from || '',
        to: md.to || '',
        fromName: md.fromName || '',
        direction: 'inbound',
        status: 'ringing',
        startTime: e.timestamp,
      };
    void this.dispatch(event, call);
  }

  /**
   * Dispatch a specific event for a call. Used internally for status-derived and
   * audit-derived events. Safe to call repeatedly — the (call, event) pair is
   * de-duplicated.
   */
  async dispatch(event: string, call: CallLog): Promise<void> {
    if (!call?.id) return;
    const dedupeKey = `${call.id}:${event}`;
    if (this.seen.has(dedupeKey)) return;
    this.markSeen(dedupeKey);

    // The owners a webhook may belong to: the local extension on each leg. An
    // external/PSTN leg resolves to undefined and is skipped. Prefer the
    // extensions already resolved on the call; fall back to resolving the raw
    // from/to legs (audit-derived calls may not have them set).
    const owners = new Set<string>();
    const fromExt = call.fromExt ?? this.resolveExt(call.from);
    const toExt = call.toExt ?? this.resolveExt(call.to);
    if (fromExt) owners.add(fromExt);
    if (toExt) owners.add(toExt);
    if (owners.size === 0) return;

    const snapshot = toSnapshot(call);
    for (const owner of owners) {
      let hooks;
      try {
        hooks = await this.db.getWebhooksForOwner(owner);
      } catch {
        continue;
      }
      for (const hook of hooks) {
        // An empty subscription list means "all events".
        if (hook.events.length > 0 && !hook.events.includes(event)) continue;
        const idempotencyKey = `${hook.id}:${call.id}:${event}`;
        const body: WebhookEventPayload = {
          event,
          idempotencyKey,
          timestamp: new Date().toISOString(),
          webhookId: hook.id,
          owner,
          call: snapshot,
        };
        const job: WebhookDeliverJob = {
          webhookId: hook.id,
          url: hook.url,
          secret: hook.secret,
          event,
          idempotencyKey,
          body,
        };
        // Best-effort enqueue; a Redis hiccup must never bubble into call handling.
        void this.enqueue(WriteJob.WebhookDeliver, job).catch((err) =>
          console.warn(`⚠️  webhook enqueue failed (${event} → ${hook.url}): ${err?.message}`),
        );
      }
    }
  }

  /** Resolve a call leg (extension/username/phone) to a local extension, if any. */
  private resolveExt(leg: string): string | undefined {
    if (!leg) return undefined;
    return this.db.getUser(leg)?.extension ?? this.db.getUserByPhone(leg)?.extension;
  }

  private markSeen(key: string): void {
    this.seen.set(key, true);
    if (this.seen.size > MAX_SEEN) {
      // Evict the oldest ~10% in one pass.
      const drop = Math.floor(MAX_SEEN * 0.1);
      let i = 0;
      for (const k of this.seen.keys()) {
        this.seen.delete(k);
        if (++i >= drop) break;
      }
    }
  }
}

/** Project a CallLog onto the public, owner-safe webhook payload shape. */
function toSnapshot(call: CallLog): WebhookCallSnapshot {
  return {
    id: call.id,
    from: call.from,
    to: call.to,
    fromName: call.fromName,
    direction: call.direction,
    status: call.status,
    startTime: call.startTime,
    endTime: call.endTime,
    duration: call.duration,
    fromExt: call.fromExt,
    toExt: call.toExt,
    cost: call.cost,
    currency: call.currency,
  };
}
