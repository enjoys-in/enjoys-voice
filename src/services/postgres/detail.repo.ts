import { getPool } from './pool';

/**
 * Per-user routing detail stored by the Go API in separate tables. Node reads
 * these so the live SIP engine's blocking / forwarding / PSTN decisions match
 * exactly what the dashboard wrote via Go (one source of truth).
 *
 * Each loader comes in two flavours:
 *  - loadAll*  → bulk, used once at startup to populate every user (routing must
 *    work for users who never registered, e.g. forward-on-unavailable or an
 *    inbound PSTN call targeting an offline user).
 *  - load*ByExtension → single user, used to refresh on SIP REGISTER.
 */

export interface BlockedRow {
  extension: string;
  number: string;
}

export interface ForwardingRow {
  extension: string;
  // 'busy' | 'noAnswer' | 'unavailable' — matches Node's forwarding types 1:1.
  type: string;
  target: string | null;
}

export interface PstnRow {
  extension: string;
  pstn_enabled: boolean;
  pstn_mobile: string | null;
  dnd: boolean;
  /** Assigned billing rate plan id, or null to use the workspace default. */
  rate_plan_id: number | null;
  /** Verified outbound caller ID, or null when unset/unverified. The SQL gates
   * this on caller_id_verified so Node never sees an unverified number. */
  outbound_caller_id: string | null;
}

export async function loadAllBlocked(): Promise<BlockedRow[]> {
  const { rows } = await getPool().query<BlockedRow>(
    'SELECT extension, number FROM blocked_numbers',
  );
  return rows;
}

export async function loadBlockedByExtension(extension: string): Promise<BlockedRow[]> {
  const { rows } = await getPool().query<BlockedRow>(
    'SELECT extension, number FROM blocked_numbers WHERE extension = $1',
    [extension],
  );
  return rows;
}

export async function loadAllForwarding(): Promise<ForwardingRow[]> {
  const { rows } = await getPool().query<ForwardingRow>(
    'SELECT extension, type, target FROM forwarding_rules',
  );
  return rows;
}

export async function loadForwardingByExtension(extension: string): Promise<ForwardingRow[]> {
  const { rows } = await getPool().query<ForwardingRow>(
    'SELECT extension, type, target FROM forwarding_rules WHERE extension = $1',
    [extension],
  );
  return rows;
}

export async function loadAllPstn(): Promise<PstnRow[]> {
  const { rows } = await getPool().query<PstnRow>(
    `SELECT extension, pstn_enabled, pstn_mobile, COALESCE(dnd, false) AS dnd, rate_plan_id,
            CASE WHEN COALESCE(caller_id_verified, false) THEN outbound_caller_id ELSE NULL END AS outbound_caller_id
     FROM user_settings`,
  );
  return rows;
}

export async function loadPstnByExtension(extension: string): Promise<PstnRow | null> {
  const { rows } = await getPool().query<PstnRow>(
    `SELECT extension, pstn_enabled, pstn_mobile, COALESCE(dnd, false) AS dnd, rate_plan_id,
            CASE WHEN COALESCE(caller_id_verified, false) THEN outbound_caller_id ELSE NULL END AS outbound_caller_id
     FROM user_settings WHERE extension = $1 LIMIT 1`,
    [extension],
  );
  return rows[0] ?? null;
}

/** Prepaid wallet row (Go-owned `user_balances` table). `balance` is a
 * numeric(12,4) so pg returns it as a string — parse to a number on read. */
export interface BalanceRow {
  extension: string;
  balance: number;
  currency: string;
}

interface BalanceRowRaw {
  extension: string;
  balance: string | number;
  currency: string;
}

function mapBalance(row: BalanceRowRaw): BalanceRow {
  return {
    extension: row.extension,
    balance: typeof row.balance === 'number' ? row.balance : parseFloat(row.balance) || 0,
    currency: row.currency,
  };
}

export async function loadAllBalances(): Promise<BalanceRow[]> {
  try {
    const { rows } = await getPool().query<BalanceRowRaw>(
      'SELECT extension, balance, currency FROM user_balances',
    );
    return rows.map(mapBalance);
  } catch (err: any) {
    // The table is created by the Go API's migration; if Node starts first it
    // may not exist yet. Degrade to "no wallets" rather than failing hydration.
    console.warn(`⚠️  balance: loadAllBalances failed (${err?.message}); treating as none`);
    return [];
  }
}

export async function loadBalanceByExtension(extension: string): Promise<BalanceRow | null> {
  try {
    const { rows } = await getPool().query<BalanceRowRaw>(
      'SELECT extension, balance, currency FROM user_balances WHERE extension = $1 LIMIT 1',
      [extension],
    );
    return rows[0] ? mapBalance(rows[0]) : null;
  } catch (err: any) {
    console.warn(`⚠️  balance: loadBalanceByExtension(${extension}) failed (${err?.message}); treating as none`);
    return null;
  }
}

