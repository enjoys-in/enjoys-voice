import { PgNotifyListener } from './pg-listener';

/** Postgres NOTIFY channel the settings triggers publish to. */
const CHANNEL = 'settings_changed';

/**
 * The per-user routing settings the Go API owns live in separate tables —
 * `blocked_numbers`, `forwarding_rules`, `user_settings` (PSTN) and the prepaid
 * wallet `user_balances`. A change to any of them must refresh that one user's
 * in-memory detail so the live SIP path keeps deciding from memory (no per-call
 * DB read) — including the wallet balance the prepaid gate reads. The users-table
 * trigger does NOT fire for these, so this installs a shared trigger across all
 * of them that NOTIFYs the affected extension (plus the source table, handy
 * for debugging).
 *
 * Each table is guarded with `to_regclass` so a table that doesn't exist yet (a
 * Node-first boot before Go's AutoMigrate has run) is skipped rather than
 * aborting the whole batch — the trigger is reinstalled on every reconnect, so
 * it self-heals once the table appears. Run as one dollar-quoted batch so
 * node-postgres doesn't split it on `;`.
 */
const INSTALL_TRIGGER_SQL = `
CREATE OR REPLACE FUNCTION notify_settings_changed() RETURNS trigger AS $$
DECLARE
  ext text;
BEGIN
  IF (TG_OP = 'DELETE') THEN
    ext := OLD.extension;
  ELSE
    ext := NEW.extension;
  END IF;
  PERFORM pg_notify(
    '${CHANNEL}',
    json_build_object('extension', ext, 'op', TG_OP, 'source', TG_TABLE_NAME)::text
  );
  IF (TG_OP = 'DELETE') THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['blocked_numbers', 'forwarding_rules', 'user_settings', 'user_balances'] LOOP
    IF to_regclass('public.' || tbl) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', tbl || '_settings_trigger', tbl);
      EXECUTE format(
        'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION notify_settings_changed()',
        tbl || '_settings_trigger', tbl
      );
    END IF;
  END LOOP;
END $$;
`;

interface SettingsSyncOptions {
  /**
   * Reconcile a single user's blocking / forwarding / PSTN detail after a change
   * — wire to DatabaseService.hydrateUserDetail, which reloads exactly those
   * three tables for one extension into memory.
   */
  onSettingsChanged: (extension: string) => Promise<void> | void;
  /**
   * Called after a reconnect. Notifications emitted while disconnected are lost,
   * so the consumer should re-hydrate here to catch missed changes.
   */
  onReconnect?: () => Promise<void> | void;
}

/**
 * Listens for per-user settings changes (block list, call forwarding, PSTN
 * forwarding) in the shared Postgres database via LISTEN/NOTIFY and refreshes
 * just that user's in-memory routing detail in near real time. So when a user
 * toggles "block" or PSTN forwarding from the dashboard (written by the Go API),
 * the live SIP engine picks it up on the very next call without a restart and
 * without reading the DB on the call path.
 *
 * Connection lifecycle (dedicated client + auto-reconnect with backoff, trigger
 * (re)install and re-hydrate on connect) is handled by {@link PgNotifyListener}.
 */
export class SettingsSyncListener extends PgNotifyListener {
  protected readonly channel = CHANNEL;
  protected get label(): string {
    return 'settings-sync';
  }

  constructor(private opts: SettingsSyncOptions) {
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
      await this.opts.onSettingsChanged(extension);
    } catch (err: any) {
      console.warn(`⚠️  settings-sync apply failed for ${extension}: ${err?.message}`);
    }
  }
}
