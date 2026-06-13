import { getPool } from './pool';
import type { AuditEntry } from '../audit.service';

/**
 * The shared `audit_logs` table is owned by the Go API (GORM AutoMigrate). Node
 * only ever appends rows, so this CREATE ... IF NOT EXISTS is a best-effort guard
 * for a Node-first boot (or a Node-only deploy) and mirrors the Go AuditLog model
 * exactly — it never conflicts with GORM's migration (which is additive). When Go
 * has already created the table this is a no-op.
 */
const ENSURE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS audit_logs (
    id BIGSERIAL PRIMARY KEY,
    extension VARCHAR(20),
    event VARCHAR(64) NOT NULL,
    detail TEXT,
    created_at TIMESTAMPTZ
  )`;

const ENSURE_INDEX_SQL = [
  `CREATE INDEX IF NOT EXISTS idx_audit_logs_extension ON audit_logs(extension)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_logs_event ON audit_logs(event)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at)`,
];

export async function ensureAuditSchema(): Promise<void> {
  const pool = getPool();
  await pool.query(ENSURE_TABLE_SQL);
  for (const sql of ENSURE_INDEX_SQL) await pool.query(sql);
}

/**
 * Fold the structured metadata (+ optional source ip) into the single free-form
 * `detail` text column the Go AuditLog model exposes. Returns null when there is
 * nothing to record so the column stays empty rather than holding "{}".
 */
function toDetail(entry: AuditEntry): string | null {
  const hasMeta = entry.metadata && Object.keys(entry.metadata).length > 0;
  if (!hasMeta && !entry.ip) return null;
  return JSON.stringify({
    ...(entry.metadata ?? {}),
    ...(entry.ip ? { ip: entry.ip } : {}),
  });
}

/**
 * Batch-append buffered audit entries to the shared Postgres `audit_logs` table
 * in a single multi-row INSERT. Append-only and id-less (Postgres assigns the
 * PK), so the whole batch is safe to retry on failure.
 */
export async function insertAuditLogs(entries: AuditEntry[]): Promise<void> {
  if (entries.length === 0) return;
  const pool = getPool();
  const tuples: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  for (const e of entries) {
    tuples.push(`($${i++}, $${i++}, $${i++}, $${i++})`);
    params.push(e.extension, e.event, toDetail(e), e.timestamp);
  }
  await pool.query(
    `INSERT INTO audit_logs (extension, event, detail, created_at) VALUES ${tuples.join(', ')}`,
    params,
  );
}
