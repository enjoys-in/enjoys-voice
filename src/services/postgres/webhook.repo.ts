import { getPool } from './pool';

/**
 * A webhook row as the SIP runtime needs it. Unlike the Go API's read model,
 * this includes the FULL signing `secret` — the runtime must be able to actually
 * HMAC-sign each delivery. The API redacts the secret for the dashboard; the
 * runtime reads it straight from Postgres.
 */
export interface WebhookRecord {
  id: number;
  ownerExtension: string;
  name: string;
  url: string;
  /** HMAC-SHA256 signing secret. Empty string when none is configured. */
  secret: string;
  /** Subscribed event names. An EMPTY array means "all events". */
  events: string[];
  enabled: boolean;
}

interface WebhookRow {
  id: number | string;
  owner_extension: string;
  name: string;
  url: string;
  secret: string | null;
  events: string | null;
  enabled: boolean;
}

function rowToWebhook(r: WebhookRow): WebhookRecord {
  const events = (r.events ?? '')
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);
  return {
    id: Number(r.id),
    ownerExtension: r.owner_extension,
    name: r.name,
    url: r.url,
    secret: r.secret ?? '',
    events,
    enabled: !!r.enabled,
  };
}

/**
 * Load every ENABLED webhook from the shared `webhooks` table the Go API owns.
 * The SIP runtime only ever READS webhooks (it never edits them) and groups them
 * by owner extension in memory to fire deliveries on call events. The table is
 * small (a handful of webhooks per user), so the whole set is loaded at once and
 * cached, refreshed on NOTIFY. Returns [] when the table doesn't exist yet (the
 * Go API creates it on first migrate).
 */
export async function loadEnabledWebhooks(): Promise<WebhookRecord[]> {
  try {
    const { rows } = await getPool().query(
      `SELECT id, owner_extension, name, url, secret, events, enabled
         FROM webhooks
        WHERE enabled = TRUE`,
    );
    return (rows as WebhookRow[]).map(rowToWebhook);
  } catch (err: any) {
    // 42P01 = undefined_table — the Go API hasn't migrated `webhooks` yet.
    if (err?.code === '42P01') return [];
    throw err;
  }
}
