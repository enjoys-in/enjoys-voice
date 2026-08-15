import { PgNotifyListener } from './pg-listener';

/** Postgres NOTIFY channel the `contacts` trigger publishes to. */
const CHANNEL = 'contacts_changed';

/**
 * Fire on every `contacts` insert/update/delete so the SIP runtime refreshes the
 * affected owner's cached contact→name map WITHOUT a restart — keeping inbound
 * caller-ID enrichment current. Payload is the owner extension. The trigger is
 * installed idempotently on every (re)connect, guarded so it is a no-op until
 * the Go API has created the table (Node-first boot).
 */
const INSTALL_TRIGGER_SQL = `
CREATE OR REPLACE FUNCTION notify_contacts_changed() RETURNS trigger AS $$
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
  IF to_regclass('public.contacts') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS contacts_notify_trigger ON contacts;
    CREATE TRIGGER contacts_notify_trigger
      AFTER INSERT OR UPDATE OR DELETE ON contacts
      FOR EACH ROW EXECUTE FUNCTION notify_contacts_changed();
  END IF;
END $$;
`;

export interface ContactSyncOptions {
  /** Reconcile one owner's cached contacts after a change. */
  onChanged: (owner: string) => Promise<void> | void;
  /** Called after a reconnect (missed NOTIFYs) — re-hydrate all. */
  onReconnect?: () => Promise<void> | void;
}

/**
 * Keeps each user's in-memory contact→name map in sync with the shared Postgres
 * `contacts` table the Go API owns. Same dedicated-LISTEN-client, self-healing
 * pattern as SettingsSync / WebhookSync.
 */
export class ContactSyncListener extends PgNotifyListener {
  protected readonly channel = CHANNEL;
  protected get label(): string {
    return 'contact-sync';
  }

  constructor(private opts: ContactSyncOptions) {
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
      await this.opts.onChanged(payload);
    } catch (err: any) {
      console.warn(`⚠️  contact-sync apply failed for ${payload}: ${err?.message}`);
    }
  }
}
