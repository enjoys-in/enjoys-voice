import { Client } from 'pg';
import { config } from '@/core';

/** Postgres NOTIFY channel the users-table trigger publishes to. */
const CHANNEL = 'users_changed';

/**
 * SQL that installs (idempotently) a trigger which fires pg_notify on every
 * INSERT/UPDATE/DELETE of the users table. The payload is a small JSON object
 * carrying the affected extension and the operation. Run as a single statement
 * batch by node-postgres (the dollar-quoted body is NOT split), so it sidesteps
 * the Go migration runner's naive `;` splitter — and keeps this feature wholly
 * owned by the process that consumes it.
 */
const INSTALL_TRIGGER_SQL = `
CREATE OR REPLACE FUNCTION notify_users_changed() RETURNS trigger AS $$
DECLARE
  ext text;
BEGIN
  IF (TG_OP = 'DELETE') THEN
    ext := OLD.extension;
  ELSE
    ext := NEW.extension;
  END IF;
  PERFORM pg_notify('${CHANNEL}', json_build_object('extension', ext, 'op', TG_OP)::text);
  IF (TG_OP = 'DELETE') THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_changed_trigger ON users;
CREATE TRIGGER users_changed_trigger
  AFTER INSERT OR UPDATE OR DELETE ON users
  FOR EACH ROW EXECUTE FUNCTION notify_users_changed();
`;

interface UserSyncOptions {
  /** Reconcile a single user (insert/update/delete) — see DatabaseService.syncUser. */
  onUserChanged: (extension: string) => Promise<void> | void;
  /**
   * Called after a reconnect. Notifications emitted while disconnected are lost,
   * so the consumer should do a full re-hydrate here to catch missed changes.
   */
  onReconnect?: () => Promise<void> | void;
}

/**
 * Listens for user-table changes in the shared Postgres database via LISTEN/
 * NOTIFY and reconciles Node's in-memory store in near real time, so an account
 * created, edited or deleted through the Go API is reflected without a restart.
 *
 * Uses a DEDICATED long-lived client (LISTEN cannot run on a pooled connection
 * that gets handed to other queries) and auto-reconnects with backoff. On every
 * (re)connect it reinstalls the trigger (idempotent) and re-hydrates so it is
 * self-healing even if it starts before the table/trigger exist.
 */
export class UserSyncListener {
  private client: Client | null = null;
  private stopped = false;
  private reconnectDelayMs = 1000;
  private readonly maxReconnectDelayMs = 30000;

  constructor(private opts: UserSyncOptions) {}

  async start(): Promise<void> {
    this.stopped = false;
    await this.connect();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    const client = this.client;
    this.client = null;
    if (client) {
      try {
        await client.end();
      } catch {
        /* already closed */
      }
    }
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;

    const client = new Client({ connectionString: config.database.url });
    this.client = client;

    // A connection-level error (e.g. server restart) ends the client; schedule
    // a reconnect rather than letting the unhandled error crash the process.
    client.on('error', (err) => {
      console.warn(`⚠️  user-sync listener error: ${err.message}`);
      this.scheduleReconnect();
    });
    client.on('end', () => this.scheduleReconnect());
    client.on('notification', (msg) => this.handleNotification(msg.payload));

    try {
      await client.connect();
      await client.query(INSTALL_TRIGGER_SQL);
      await client.query(`LISTEN ${CHANNEL}`);
      this.reconnectDelayMs = 1000; // reset backoff on a clean connect
      console.log(`✅ DB: user-sync listening on "${CHANNEL}"`);
      // Catch anything that changed before we (re)connected.
      await this.opts.onReconnect?.();
    } catch (err: any) {
      console.warn(`⚠️  user-sync connect failed: ${err?.message}`);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || !this.client) return;
    // Null the client so concurrent error+end events schedule only one retry.
    this.client = null;
    const delay = this.reconnectDelayMs;
    this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, this.maxReconnectDelayMs);
    setTimeout(() => void this.connect(), delay);
  }

  private async handleNotification(payload?: string): Promise<void> {
    if (!payload) return;
    let extension: string | undefined;
    try {
      extension = JSON.parse(payload).extension;
    } catch {
      // Older/plain payloads: treat the raw string as the extension.
      extension = payload;
    }
    if (!extension) return;
    try {
      await this.opts.onUserChanged(extension);
    } catch (err: any) {
      console.warn(`⚠️  user-sync apply failed for ${extension}: ${err?.message}`);
    }
  }
}
