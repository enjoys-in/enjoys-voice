import { PgNotifyListener } from './pg-listener';

/** Postgres NOTIFY channel the `routing_rules` trigger publishes to. */
const CHANNEL = 'routing_rules_changed';

/**
 * Fire on every `routing_rules` insert/update/delete so the SIP runtime can drop
 * its cached rule lookups and pick up dashboard edits WITHOUT a restart. Because
 * a single edit can change a rule's match key (its owner extension or matched
 * number), the listener clears the whole (small) cache rather than a single
 * entry. The trigger is installed idempotently on every (re)connect, guarded so
 * it is a no-op until the Go API has created the table.
 */
const INSTALL_TRIGGER_SQL = `
CREATE OR REPLACE FUNCTION notify_routing_rules_changed() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('${CHANNEL}', COALESCE(NEW.owner_extension, OLD.owner_extension));
  IF (TG_OP = 'DELETE') THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF to_regclass('public.routing_rules') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS routing_rules_notify_trigger ON routing_rules;
    CREATE TRIGGER routing_rules_notify_trigger
      AFTER INSERT OR UPDATE OR DELETE ON routing_rules
      FOR EACH ROW EXECUTE FUNCTION notify_routing_rules_changed();
  END IF;
END $$;
`;

export interface RoutingRuleSyncOptions {
  /** Called on any rule change so the cached lookups can be cleared. */
  onChanged: () => Promise<void> | void;
  /** Called after a (re)connect to drop the whole cache (changes may be missed). */
  onReconnect?: () => Promise<void> | void;
}

/**
 * Keeps the SIP engine's in-memory routing-rule cache in sync with the shared
 * Postgres table the Go API owns. Same dedicated-LISTEN-client, self-healing
 * pattern as UserSync / SettingsSync / RateSync / IvrFlowSync / ConnectorSync.
 */
export class RoutingRuleSyncListener extends PgNotifyListener {
  protected readonly channel = CHANNEL;
  protected get label(): string {
    return 'routing-rule-sync';
  }

  constructor(private opts: RoutingRuleSyncOptions) {
    super();
  }

  protected installSql(): string {
    return INSTALL_TRIGGER_SQL;
  }

  protected async onConnected(): Promise<void> {
    await this.opts.onReconnect?.();
  }

  protected async handlePayload(): Promise<void> {
    try {
      await this.opts.onChanged();
    } catch (err: any) {
      console.warn(`⚠️  routing-rule-sync invalidate failed: ${err?.message}`);
    }
  }
}
