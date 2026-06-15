import { config } from '@/core';
import { ensureAuditSchema, insertAuditLogs } from './postgres';

export interface AuditEntry {
  id: string;
  timestamp: string;
  userId: string;
  extension: string;
  event: AuditEvent;
  metadata?: Record<string, any>;
  ip?: string;
}

export type AuditEvent =
  | 'register'
  | 'unregister'
  | 'call_start'
  | 'call_answered'
  | 'call_declined'
  | 'call_ended'
  | 'call_failed'
  | 'call_forwarded'
  | 'voicemail_left'  
  | 'voicemail_received'
  | 'voicemail_deleted'
  | 'ivr_entered'
  | 'ivr_exited'
  | 'ivr_timeout'
  | 'ivr_noanswer'
  | 'ivr_extension_selected'
  | 'ivr_extension_timeout'
  | 'ivr_extension_noanswer'  
  | 'trunk_call_start'  
  | 'trunk_call_ended'
  | 'trunk_call_failed'
  | 'trunk_call_answered'
  | 'trunk_call_declined'
  | 'trunk_call_forwarded'
  | 'call_blocked'
  | 'login'
  | 'signup'
  | 'block'
  | 'unblock'
  | 'forwarding_set';

export class AuditService {
  private logs: AuditEntry[] = [];
  private maxEntries = 5000;
  /**
   * Events buffered since the last successful flush, oldest first. The flush
   * timer drains this into Postgres; on failure the batch is re-queued. Separate
   * from `logs` (the newest-first in-process inspection ring buffer) so draining
   * the flush queue never disturbs the recent-events view.
   */
  private pending: AuditEntry[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private flushing = false;
  private schemaReady = false;

  /**
   * Begin periodically flushing buffered audit events to the shared Postgres
   * `audit_logs` table. No-op when audit logging is disabled (AUDIT_LOG !==
   * 'true') — in that mode log() never buffers anything, so there is nothing to
   * flush. Idempotent: calling it again while already running does nothing.
   */
  start(): void {
    if (!config.audit.enabled || this.flushTimer) return;
    this.flushTimer = setInterval(() => { void this.flush(); }, config.audit.flushIntervalMs);
    // Don't keep the event loop alive solely for the flush timer.
    this.flushTimer.unref?.();
  }

  log(event: AuditEvent, extension: string, metadata?: Record<string, any>, ip?: string): void {
    // Env gate: when audit logging is off, do not even buffer in memory.
    if (!config.audit.enabled) return;

    const entry: AuditEntry = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      userId: extension,
      extension,
      event,
      metadata,
      ip,
    };
    // Newest-first ring buffer for in-process inspection (query/getAll/...).
    this.logs.unshift(entry);
    if (this.logs.length > this.maxEntries) {
      this.logs.length = this.maxEntries;
    }
    // Oldest-first flush queue the timer drains to Postgres.
    this.pending.push(entry);
  }

  /**
   * Flush all buffered events to Postgres in one batch. Re-entrancy-guarded so a
   * slow write can't overlap the next tick. On failure the drained batch is put
   * back at the head of the queue (capped to maxEntries so a prolonged DB outage
   * can't grow memory unbounded) and retried on the following tick — best-effort,
   * at-least-once. Safe to call manually (e.g. on shutdown).
   */
  async flush(): Promise<void> {
    if (!config.audit.enabled || this.flushing || this.pending.length === 0) return;
    this.flushing = true;
    const batch = this.pending;
    this.pending = [];
    try {
      if (!this.schemaReady) {
        await ensureAuditSchema();
        this.schemaReady = true;
      }
      await insertAuditLogs(batch);
    } catch (err: any) {
      this.pending = batch.concat(this.pending).slice(0, this.maxEntries);
      console.warn(`⚠️  Audit flush failed (${err?.message}); ${this.pending.length} pending`);
    } finally {
      this.flushing = false;
    }
  }

  /** Stop the flush timer and persist anything still buffered. */
  async stop(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
  }

  query(filters: {
    user?: string;
    event?: AuditEvent;
    from?: string;
    to?: string;
    limit?: number;
  }): AuditEntry[] {
    let result = this.logs;

    if (filters.user) {
      result = result.filter(e => e.extension === filters.user);
    }
    if (filters.event) {
      result = result.filter(e => e.event === filters.event);
    }
    if (filters.from) {
      const fromTime = new Date(filters.from).getTime();
      result = result.filter(e => new Date(e.timestamp).getTime() >= fromTime);
    }
    if (filters.to) {
      const toTime = new Date(filters.to).getTime();
      result = result.filter(e => new Date(e.timestamp).getTime() <= toTime);
    }

    return result.slice(0, filters.limit || 100);
  }

  getAll(limit = 100): AuditEntry[] {
    return this.logs.slice(0, limit);
  }

  getByExtension(extension: string, limit = 50): AuditEntry[] {
    return this.logs.filter(e => e.extension === extension).slice(0, limit);
  }
}
