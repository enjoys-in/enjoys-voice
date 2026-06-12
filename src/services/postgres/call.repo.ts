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
  // Arbiter for the upsert. NULL call_ids (legacy rows) are allowed to repeat.
  `CREATE UNIQUE INDEX IF NOT EXISTS uniq_call_records_call_id ON call_records(call_id)`,
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
  await pool.query(
    `INSERT INTO call_records (call_id, "from", "to", from_name, direction, status, duration, started_at, ended_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (call_id) DO UPDATE SET
       status = EXCLUDED.status,
       duration = EXCLUDED.duration,
       ended_at = EXCLUDED.ended_at`,
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
    ],
  );
}
