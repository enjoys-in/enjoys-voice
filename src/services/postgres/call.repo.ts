import { getPool } from './pool';
import type { CallLog } from '@/core';

/**
 * Additive, nullable columns Node needs on the shared call_records table. Node
 * is the sole writer of call history (the Go API never routes a create — it only
 * reads), so it owns these fields. They are invisible to the Go API because its
 * CallRecord model doesn't reference them, and dropping them fully reverses this.
 * Run idempotently from Node so the SIP engine doesn't depend on a Go redeploy.
 */
const ENSURE_SCHEMA_SQL = [
  `ALTER TABLE call_records ADD COLUMN IF NOT EXISTS call_id VARCHAR(100)`,
  `ALTER TABLE call_records ADD COLUMN IF NOT EXISTS direction VARCHAR(10)`,
  `ALTER TABLE call_records ADD COLUMN IF NOT EXISTS from_name VARCHAR(200)`,
  // Owning local extension each leg resolves to, so "all calls for a user" is an
  // exact lookup (from_ext = ? OR to_ext = ?) that also covers PSTN legs, where
  // "from"/"to" hold an external number rather than the extension. NULL = the leg
  // is external / not a local user.
  `ALTER TABLE call_records ADD COLUMN IF NOT EXISTS from_ext VARCHAR(20)`,
  `ALTER TABLE call_records ADD COLUMN IF NOT EXISTS to_ext VARCHAR(20)`,
  // Billing fields (Node rates the call at end-of-call and stamps these). The Go
  // API reads cost for reporting but never writes it. All nullable/defaulted so
  // dropping them fully reverses billing without touching call history.
  `ALTER TABLE call_records ADD COLUMN IF NOT EXISTS cost NUMERIC(12,5) DEFAULT 0`,
  `ALTER TABLE call_records ADD COLUMN IF NOT EXISTS currency VARCHAR(3)`,
  `ALTER TABLE call_records ADD COLUMN IF NOT EXISTS rate_prefix VARCHAR(15)`,
  `ALTER TABLE call_records ADD COLUMN IF NOT EXISTS billed_secs INTEGER DEFAULT 0`,
  `ALTER TABLE call_records ADD COLUMN IF NOT EXISTS rated_at TIMESTAMPTZ`,
  // Arbiter for the upsert. NULL call_ids (legacy rows) are allowed to repeat.
  `CREATE UNIQUE INDEX IF NOT EXISTS uniq_call_records_call_id ON call_records(call_id)`,
  `CREATE INDEX IF NOT EXISTS idx_call_records_from_ext ON call_records(from_ext)`,
  `CREATE INDEX IF NOT EXISTS idx_call_records_to_ext ON call_records(to_ext)`,
];

export async function ensureCallSchema(): Promise<void> {
  const pool = getPool();
  for (const sql of ENSURE_SCHEMA_SQL) {
    await pool.query(sql);
  }
}

/** Prefer an explicit duration; otherwise derive it from the timestamps. */
function durationSeconds(call: CallLog): number {
  if (typeof call.duration === 'number') return call.duration;
  if (call.endTime) {
    return Math.max(0, Math.round((Date.parse(call.endTime) - Date.parse(call.startTime)) / 1000));
  }
  return 0;
}

/**
 * Insert or update one call in the shared Postgres call_records table, keyed by
 * the SIP call id. logCall creates the row (status "ringing"); each updateCall
 * upserts the evolving status / end time / duration. Idempotent — safe to apply
 * the same call event more than once (e.g. a queue retry).
 */
export async function upsertCall(call: CallLog): Promise<void> {
  const pool = getPool();
  // Stamp rated_at only once a cost has been computed, so re-upserts of the same
  // (already-rated) call keep the original rating timestamp.
  const rated = typeof call.cost === 'number';
  await pool.query(
    `INSERT INTO call_records (call_id, "from", "to", from_name, direction, status, duration, started_at, ended_at, from_ext, to_ext, cost, currency, rate_prefix, billed_secs, rated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
     ON CONFLICT (call_id) DO UPDATE SET
       status = EXCLUDED.status,
       duration = EXCLUDED.duration,
       ended_at = EXCLUDED.ended_at,
       cost = EXCLUDED.cost,
       currency = EXCLUDED.currency,
       rate_prefix = EXCLUDED.rate_prefix,
       billed_secs = EXCLUDED.billed_secs,
       rated_at = COALESCE(call_records.rated_at, EXCLUDED.rated_at)`,
    [
      call.id,
      call.from,
      call.to,
      call.fromName,
      call.direction,
      call.status,
      durationSeconds(call),
      call.startTime,
      call.endTime ?? null,
      call.fromExt ?? null,
      call.toExt ?? null,
      call.cost ?? 0,
      call.currency ?? null,
      call.ratePrefix ?? null,
      call.billedSecs ?? 0,
      rated ? new Date().toISOString() : null,
    ],
  );
}

/** TIMESTAMPTZ comes back from pg as a Date; normalise to an ISO string. */
function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/**
 * Load the most recent calls from the shared call_records table, newest first,
 * mapped back to the in-memory CallLog shape. Backs the Node engine's boot-time
 * rehydration of "recents": the in-memory log is the source the HTTP API reads,
 * but it starts empty on each restart — without this, history would be blank
 * after a reboot even though the rows persist here. Reads the additive columns
 * ensureCallSchema guarantees exist, so call it after ensureCallSchema().
 */
export async function loadRecentCalls(limit = 500): Promise<CallLog[]> {
  const { rows } = await getPool().query(
    `SELECT id, call_id, "from", "to", from_name, direction, status,
            duration, started_at, ended_at, from_ext, to_ext,
            cost, currency, rate_prefix, billed_secs
       FROM call_records
      ORDER BY started_at DESC NULLS LAST, id DESC
      LIMIT $1`,
    [limit],
  );
  return rows.map((r): CallLog => ({
    id: r.call_id ?? String(r.id),
    from: r.from,
    to: r.to,
    fromName: r.from_name ?? '',
    status: (r.status ?? 'ended') as CallLog['status'],
    direction: (r.direction ?? 'inbound') as CallLog['direction'],
    startTime: toIso(r.started_at),
    endTime: r.ended_at ? toIso(r.ended_at) : undefined,
    duration: r.duration ?? undefined,
    fromExt: r.from_ext ?? undefined,
    toExt: r.to_ext ?? undefined,
    cost: r.cost != null ? Number(r.cost) : undefined,
    currency: r.currency ?? undefined,
    ratePrefix: r.rate_prefix ?? undefined,
    billedSecs: r.billed_secs ?? undefined,
  }));
}
