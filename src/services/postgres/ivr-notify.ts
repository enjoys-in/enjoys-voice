import { PgNotifyListener } from './pg-listener';

/** Postgres NOTIFY channel the `ivr_flows` trigger publishes to (payload = extension). */
const CHANNEL = 'ivr_flows_changed';

/**
 * Fire on every `ivr_flows` insert/update/delete with the affected extension as
 * the payload, so the SIP runtime can invalidate just that flow's cache entry
 * and pick up builder edits WITHOUT a restart. The trigger is installed
 * idempotently on every (re)connect, guarded so it is a no-op until the Go API
 * has created the table.
 */
const INSTALL_TRIGGER_SQL = `
CREATE OR REPLACE FUNCTION notify_ivr_flows_changed() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('${CHANNEL}', COALESCE(NEW.extension, OLD.extension));
  IF (TG_OP = 'DELETE') THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF to_regclass('public.ivr_flows') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS ivr_flows_notify_trigger ON ivr_flows;
    CREATE TRIGGER ivr_flows_notify_trigger
      AFTER INSERT OR UPDATE OR DELETE ON ivr_flows
      FOR EACH ROW EXECUTE FUNCTION notify_ivr_flows_changed();
  END IF;
END $$;
`;

export interface IvrFlowSyncOptions {
  /** Called with the changed extension so its cached flow can be invalidated. */
  onFlowChanged: (extension: string) => Promise<void> | void;
  /** Called after a (re)connect to drop the whole cache (changes may be missed). */
  onReconnect?: () => Promise<void> | void;
}

/**
 * Keeps the SIP engine's in-memory IVR-flow cache in sync with the shared
 * Postgres table the Go API owns. Same dedicated-LISTEN-client, self-healing
 * pattern as UserSync / SettingsSync / RateSync.
 */
export class IvrFlowSyncListener extends PgNotifyListener {
  protected readonly channel = CHANNEL;
  protected get label(): string {
    return 'ivr-flow-sync';
  }

  constructor(private opts: IvrFlowSyncOptions) {
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
    try {
      await this.opts.onFlowChanged(payload);
    } catch (err: any) {
      console.warn(`⚠️  ivr-flow-sync invalidate failed: ${err?.message}`);
    }
  }
}
