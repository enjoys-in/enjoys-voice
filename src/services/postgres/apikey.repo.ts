import { getPool } from './pool';

/**
 * A developer API key row as written by the Go API into the shared `api_keys`
 * table. Mirrors models.APIKey. The CSV columns (allowed_origins / allowed_ips)
 * are kept raw here and split by the consuming service.
 */
export interface DbApiKey {
  id: number;
  owner_extension: string;
  label: string;
  public_key: string;
  secret_hash: string;
  allowed_origins: string;
  allowed_ips: string;
  destination_number: string;
  caller_id: string;
  daily_cap: number;
  active: boolean;
}

const COLUMNS =
  'id, owner_extension, label, public_key, secret_hash, allowed_origins, allowed_ips, destination_number, caller_id, daily_cap, active';

/** Load a single API key by its publishable key (pk_…), or null if not found. */
export async function loadApiKeyByPublicKey(publicKey: string): Promise<DbApiKey | null> {
  const { rows } = await getPool().query<DbApiKey>(
    `SELECT ${COLUMNS} FROM api_keys WHERE public_key = $1 LIMIT 1`,
    [publicKey],
  );
  return rows[0] ?? null;
}
