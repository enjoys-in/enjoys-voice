import { PgNotifyListener } from './pg-listener';

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
 * Connection lifecycle (dedicated client + auto-reconnect with backoff, trigger
 * (re)install and re-hydrate on connect) is handled by {@link PgNotifyListener}.
 */
export class UserSyncListener extends PgNotifyListener {
  protected readonly channel = CHANNEL;
  protected get label(): string {
    return 'user-sync';
  }

  constructor(private opts: UserSyncOptions) {
    super();
  }

  protected installSql(): string {
    return INSTALL_TRIGGER_SQL;
  }

  protected async onConnected(): Promise<void> {
    await this.opts.onReconnect?.();
  }

  protected async handlePayload(payload?: string): Promise<void> {
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
