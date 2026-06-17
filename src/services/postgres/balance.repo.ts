import { getPool } from './pool';
import type { BalanceDebitJob } from '@/core';

/** Ledger reason stamped on per-call debits. Must match the Go side's
 * idempotency check (BalanceRepository.Credit treats (call_id, reason) as the
 * key), so call debits and Go top-ups never collide on the same key. */
const CALL_REASON = 'call';

/**
 * Apply a per-call charge to a prepaid wallet, atomically and idempotently.
 *
 * Node owns the call path and is therefore the writer of call debits (Go writes
 * only credits/top-ups). The whole operation runs in one transaction:
 *   1. a SELECT guards on the call id — if a `call` ledger row already exists for
 *      this call the debit was already applied, so we no-op (safe across queue
 *      retries and a repeated `ended`);
 *   2. a negative `balance_txns` ledger row records the charge;
 *   3. `user_balances` is upserted, decrementing the running balance.
 *
 * The matching `user_balances` UPDATE fires the `settings_changed` trigger, so
 * the engine re-hydrates the in-memory wallet for that extension automatically —
 * no manual in-memory decrement, keeping the DB the single source of truth.
 *
 * Money is kept in the numeric(12,4) columns; the amount is rounded to 4 dp on
 * the way in so float input can't smuggle in sub-precision drift.
 */
export async function debitForCall(job: BalanceDebitJob): Promise<void> {
  const { extension, callId, currency } = job;
  const amount = Math.round(job.amount * 10000) / 10000;
  if (!extension || !callId || !(amount > 0)) return;

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Idempotency: at most one `call` debit per call id.
    const existing = await client.query(
      'SELECT 1 FROM balance_txns WHERE call_id = $1 AND reason = $2 LIMIT 1',
      [callId, CALL_REASON],
    );
    if (existing.rowCount && existing.rowCount > 0) {
      await client.query('ROLLBACK');
      return;
    }

    // Ledger entry (signed negative = debit).
    await client.query(
      `INSERT INTO balance_txns (extension, amount, currency, reason, call_id, created_at)
       VALUES ($1, $2, $3, $4, $5, now())`,
      [extension, -amount, currency, CALL_REASON, callId],
    );

    // Decrement the wallet, creating it (negative) if it doesn't exist yet.
    await client.query(
      `INSERT INTO user_balances (extension, currency, balance, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (extension) DO UPDATE SET
         balance = user_balances.balance - $4,
         currency = COALESCE(NULLIF(user_balances.currency, ''), EXCLUDED.currency),
         updated_at = now()`,
      [extension, currency, -amount, amount],
    );

    await client.query('COMMIT');
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* connection already broken */
    }
    // Re-throw so the write queue retries (it requeues behind the backlog).
    throw err;
  } finally {
    client.release();
  }
}
