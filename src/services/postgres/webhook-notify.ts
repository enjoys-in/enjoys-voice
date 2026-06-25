import { PgNotifyListener } from './pg-listener';

/** Postgres NOTIFY channel the `webhooks` trigger publishes to. */
const CHANNEL = 'webhooks_changed';

/**
 * Fire on every `webhooks` insert/update/delete so the SIP runtime can drop its
 * cached webhook set and pick up dashboard edits WITHOUT a restart. A single
 * edit can change an owner, URL, secret or event subscription, so the listener
 * clears the whole (small) cache rather than a single entry. The trigger is
 * installed idempotently on every (re)connect, guarded so it is a no-op until
 * the Go API has created the table.
 */
const INSTALL_TRIGGER_SQL = `
CREATE OR REPLACE FUNCTION notify_webhooks_changed() RETURNS trigger AS $$
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
  IF to_regclass('public.webhooks') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS webhooks_notify_trigger ON webhooks;
    CREATE TRIGGER webhooks_notify_trigger
      AFTER INSERT OR UPDATE OR DELETE ON webhooks
      FOR EACH ROW EXECUTE FUNCTION notify_webhooks_changed();
  END IF;
END $$;
`;

export interface WebhookSyncOptions {
  /** Called on any webhook change so the cached set can be cleared/reloaded. */
  onChanged: () => Promise<void> | void;
  /** Called after a (re)connect to drop the whole cache (changes may be missed). */
  onReconnect?: () => Promise<void> | void;
}

/**
 * Keeps the SIP engine's in-memory webhook cache in sync with the shared
 * Postgres table the Go API owns. Same dedicated-LISTEN-client, self-healing
 * pattern as UserSync / SettingsSync / RateSync / IvrFlowSync / ConnectorSync /
 * RoutingRuleSync.
 */
export class WebhookSyncListener extends PgNotifyListener {
  protected readonly channel = CHANNEL;
  protected get label(): string {
    return 'webhook-sync';
  }

  constructor(private opts: WebhookSyncOptions) {
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
      console.warn(`⚠️  webhook-sync invalidate failed: ${err?.message}`);
    }
  }
}
