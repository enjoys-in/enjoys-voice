import { EventEmitter } from 'events';
import { DbEvent } from '@/core';
import type { CallLog } from '@/core';
import { DatabaseService } from './database.service';

/**
 * Live, in-memory call-metrics snapshot for the admin dashboard. All values are
 * derived from the SIP engine's call lifecycle — they are NOT read from the DB.
 */
export interface MetricsSnapshot {
  /** Calls currently in progress (ringing or answered). */
  activeTotal: number;
  activeInbound: number;
  activeOutbound: number;
  /** Highest simultaneous active-call count seen since `since`. */
  maxConcurrent: number;
  /** Highest simultaneous active INBOUND channel count since `since`. */
  peakInboundConcurrent: number;
  /** Outbound call attempts started in the last 1s window. */
  outboundCurrentCps: number;
  /** Highest outbound calls-per-second seen since `since`. */
  outboundPeakCps: number;
  /** ISO timestamp the tracker started counting (process start). */
  since: string;
  /** ISO timestamp this snapshot was produced. */
  updatedAt: string;
}

const ACTIVE_STATUSES = new Set<CallLog['status']>(['ringing', 'answered']);
// Safety valve: drop calls that never received a terminal event (e.g. the SIP
// dialog leaked) so a stuck leg can't inflate concurrency forever.
const STALE_MS = 4 * 60 * 60 * 1000; // 4h
const CPS_WINDOW_MS = 1000;
const TICK_MS = 3000;

/**
 * Tracks live call concurrency and outbound CPS by listening to the single
 * `DbEvent.CallUpserted` event the DatabaseService emits on every logCall /
 * updateCall. This is the one choke point every call leg flows through, so the
 * tracker needs no per-handler hooks. Emits a throttled `snapshot` event on
 * every change plus a periodic heartbeat (so the dashboard's "current CPS"
 * decays and "last updated" stays fresh while idle).
 */
export class CallMetricsService extends EventEmitter {
  private active = new Map<string, { direction: 'inbound' | 'outbound'; startedAt: number }>();
  private maxConcurrent = 0;
  private peakInboundConcurrent = 0;
  private outboundStarts: number[] = []; // epoch ms of recent outbound starts
  private outboundPeakCps = 0;
  private readonly since = new Date();
  private ticker?: ReturnType<typeof setInterval>;

  constructor(private db: DatabaseService) {
    super();
    this.db.on(DbEvent.CallUpserted, (call: CallLog) => this.onCall(call));
  }

  /** Begin the periodic heartbeat (decays CPS, refreshes "last updated"). */
  start(): void {
    if (this.ticker) return;
    this.ticker = setInterval(() => {
      this.sweepStale();
      this.emit('snapshot', this.getSnapshot());
    }, TICK_MS);
    // Don't keep the event loop alive solely for metrics.
    this.ticker.unref?.();
  }

  stop(): void {
    if (this.ticker) {
      clearInterval(this.ticker);
      this.ticker = undefined;
    }
  }

  private onCall(call: CallLog): void {
    if (!call?.id) return;
    const isActive = ACTIVE_STATUSES.has(call.status);

    if (isActive) {
      const prev = this.active.get(call.id);
      // Count an OUTBOUND attempt toward CPS the first time a leg is (or
      // becomes) outbound. The SIP server logs every INVITE as inbound and only
      // tags it outbound once the external/trunk handler routes it to PSTN, so
      // that inbound→outbound transition is the real outbound start.
      const becameOutbound = call.direction === 'outbound' && prev?.direction !== 'outbound';
      this.active.set(call.id, {
        direction: call.direction,
        startedAt: prev?.startedAt ?? Date.now(),
      });
      if (becameOutbound) this.recordOutboundStart();
    } else {
      // Terminal status (ended/missed/failed/voicemail/unreachable) → leg done.
      this.active.delete(call.id);
    }

    this.recomputePeaks();
    this.emit('snapshot', this.getSnapshot());
  }

  private recordOutboundStart(): void {
    const now = Date.now();
    this.outboundStarts.push(now);
    this.trimCps(now);
    const cps = this.outboundStarts.length;
    if (cps > this.outboundPeakCps) this.outboundPeakCps = cps;
  }

  private trimCps(now: number): void {
    const cutoff = now - CPS_WINDOW_MS;
    while (this.outboundStarts.length && this.outboundStarts[0] < cutoff) {
      this.outboundStarts.shift();
    }
  }

  private recomputePeaks(): void {
    const total = this.active.size;
    if (total > this.maxConcurrent) this.maxConcurrent = total;
    let inbound = 0;
    for (const leg of this.active.values()) if (leg.direction === 'inbound') inbound++;
    if (inbound > this.peakInboundConcurrent) this.peakInboundConcurrent = inbound;
  }

  private sweepStale(): void {
    const cutoff = Date.now() - STALE_MS;
    let changed = false;
    for (const [id, leg] of this.active) {
      if (leg.startedAt < cutoff) {
        this.active.delete(id);
        changed = true;
      }
    }
    if (changed) this.recomputePeaks();
  }

  getSnapshot(): MetricsSnapshot {
    this.trimCps(Date.now());
    let inbound = 0;
    let outbound = 0;
    for (const leg of this.active.values()) {
      if (leg.direction === 'inbound') inbound++;
      else outbound++;
    }
    return {
      activeTotal: this.active.size,
      activeInbound: inbound,
      activeOutbound: outbound,
      maxConcurrent: this.maxConcurrent,
      peakInboundConcurrent: this.peakInboundConcurrent,
      outboundCurrentCps: this.outboundStarts.length,
      outboundPeakCps: this.outboundPeakCps,
      since: this.since.toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }
}
