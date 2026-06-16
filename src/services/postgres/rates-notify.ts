import { PgNotifyListener } from './pg-listener';

/** Postgres NOTIFY channel the rate-plan / rate triggers publish to. */
const CHANNEL = 'rates_changed';

/**
 * Reload the whole rate book on any change. Rate tables are tiny and change
 * rarely (admin edits), so a coarse "something changed → reload all" is simpler
 * and safer than diffing individual rows.
 */
const INSTALL_TRIGGER_SQL = `
CREATE OR REPLACE FUNCTION notify_rates_changed() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('${CHANNEL}', TG_TABLE_NAME);
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
  FOREACH tbl IN ARRAY ARRAY['rate_plans', 'rates'] LOOP
    IF to_regclass('public.' || tbl) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', tbl || '_rates_trigger', tbl);
      EXECUTE format(
        'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION notify_rates_changed()',
        tbl || '_rates_trigger', tbl
      );
    END IF;
  END LOOP;
END $$;
`;

export interface RateSyncOptions {
  /** Called on any rate-plan / rate change (and once on (re)connect). */
  onRatesChanged: () => Promise<void> | void;
}

/**
 * Keeps the in-memory rate book in sync with the shared Postgres tables the Go
 * API owns. Follows the same dedicated-LISTEN-client pattern as UserSync /
 * SettingsSync. The Go API mutates `rate_plans` / `rates`; this listener fires a
 * full reload so the SIP engine prices calls with current rates.
 */
export class RateSyncListener extends PgNotifyListener {
  protected readonly channel = CHANNEL;
  protected get label(): string {
    return 'rate-sync';
  }

  constructor(private opts: RateSyncOptions) {
    super();
  }

  protected installSql(): string {
    return INSTALL_TRIGGER_SQL;
  }

  protected async onConnected(): Promise<void> {
    await this.opts.onRatesChanged();
  }

  protected async handlePayload(): Promise<void> {
    try {
      await this.opts.onRatesChanged();
    } catch (err: any) {
      console.warn(`⚠️  rate-sync reload failed: ${err?.message}`);
    }
  }
}
