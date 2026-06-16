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
    'SELECT extension, pstn_enabled, pstn_mobile, COALESCE(dnd, false) AS dnd FROM user_settings',
  );
  return rows;
}

export async function loadPstnByExtension(extension: string): Promise<PstnRow | null> {
  const { rows } = await getPool().query<PstnRow>(
    'SELECT extension, pstn_enabled, pstn_mobile, COALESCE(dnd, false) AS dnd FROM user_settings WHERE extension = $1 LIMIT 1',
    [extension],
  );
  return rows[0] ?? null;
}
