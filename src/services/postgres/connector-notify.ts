import { PgNotifyListener } from './pg-listener';

/** Postgres NOTIFY channel the `connectors` trigger publishes to (payload = id). */
const CHANNEL = 'connectors_changed';

/**
 * Fire on every `connectors` insert/update/delete with the affected row id as
 * the payload, so the SIP runtime can invalidate just that connector's cache
 * entry and pick up dashboard edits WITHOUT a restart. The trigger is installed
 * idempotently on every (re)connect, guarded so it is a no-op until the Go API
 * has created the table.
 */
const INSTALL_TRIGGER_SQL = `
CREATE OR REPLACE FUNCTION notify_connectors_changed() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('${CHANNEL}', COALESCE(NEW.id, OLD.id)::text);
  IF (TG_OP = 'DELETE') THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF to_regclass('public.connectors') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS connectors_notify_trigger ON connectors;
    CREATE TRIGGER connectors_notify_trigger
      AFTER INSERT OR UPDATE OR DELETE ON connectors
      FOR EACH ROW EXECUTE FUNCTION notify_connectors_changed();
  END IF;
END $$;
`;

export interface ConnectorSyncOptions {
  /** Called with the changed connector id so its cached row can be invalidated. */
  onConnectorChanged: (id: number) => Promise<void> | void;
  /** Called after a (re)connect to drop the whole cache (changes may be missed). */
  onReconnect?: () => Promise<void> | void;
}

/**
 * Keeps the SIP engine's in-memory connector cache in sync with the shared
 * Postgres table the Go API owns. Same dedicated-LISTEN-client, self-healing
 * pattern as UserSync / SettingsSync / RateSync / IvrFlowSync.
 */
export class ConnectorSyncListener extends PgNotifyListener {
  protected readonly channel = CHANNEL;
  protected get label(): string {
    return 'connector-sync';
  }

  constructor(private opts: ConnectorSyncOptions) {
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
    const id = Number(payload);
    if (!Number.isFinite(id)) return;
    try {
      await this.opts.onConnectorChanged(id);
    } catch (err: any) {
      console.warn(`⚠️  connector-sync invalidate failed: ${err?.message}`);
    }
  }
}
