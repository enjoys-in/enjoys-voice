import { getPool } from './pool';

/**
 * A connector row as the SIP runtime needs it. Unlike the Go API's read model,
 * this includes the FULL `config` JSONB (secrets and all) — the runtime must be
 * able to actually authenticate to SMTP / sign a webhook. The API redacts
 * secrets for the dashboard; the runtime reads them straight from Postgres.
 */
export interface ConnectorRecord {
  id: number;
  name: string;
  type: string;
  enabled: boolean;
  config: Record<string, any>;
}

interface ConnectorRow {
  id: number | string;
  name: string;
  type: string;
  enabled: boolean;
  config: unknown;
}

function rowToConnector(r: ConnectorRow): ConnectorRecord {
  let cfg: any = r.config;
  if (typeof cfg === 'string') {
    try { cfg = JSON.parse(cfg); } catch { cfg = {}; }
  }
  return {
    id: Number(r.id),
    name: r.name,
    type: r.type,
    enabled: !!r.enabled,
    config: cfg && typeof cfg === 'object' ? cfg : {},
  };
}

/**
 * Read a single connector by id from the shared `connectors` table the Go API
 * owns. Returns undefined when no such row exists.
 */
export async function loadConnectorById(id: number): Promise<ConnectorRecord | undefined> {
  const { rows } = await getPool().query(
    `SELECT id, name, type, enabled, config
       FROM connectors
      WHERE id = $1`,
    [id],
  );
  return rows[0] ? rowToConnector(rows[0] as ConnectorRow) : undefined;
}
