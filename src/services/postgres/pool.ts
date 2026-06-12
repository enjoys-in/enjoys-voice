import { Pool } from 'pg';
import { config } from '@/core';

/**
 * Lazily-created singleton connection pool for the shared Postgres database
 * (the same DB the Go API owns). One pool per process is the node-postgres
 * convention; it is reused for hydration now and for the read/write paths later.
 */
let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: config.database.url, max: 5 });
    // Without a listener, an idle-client error would crash the process.
    pool.on('error', (err) => console.error('❌ PG pool error:', err.message));
  }
  return pool;
}

/** Close the pool (used on shutdown / between tests). Safe to call when unset. */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
