import { PgNotifyListener } from './pg-listener';

/** Postgres NOTIFY channel the `ai_agents` trigger publishes to. */
const CHANNEL = 'ai_agents_changed';

/**
 * Fire on every `ai_agents` insert/update/delete so the media runtime can drop
 * its cached agent set and pick up dashboard edits WITHOUT a restart. A single
 * edit can change a provider/model/voice/prompt, so the listener clears the
 * whole (small) cache rather than a single entry. The trigger is installed
 * idempotently on every (re)connect, guarded so it is a no-op until the Go API
 * has created the table.
 */
const INSTALL_TRIGGER_SQL = `
CREATE OR REPLACE FUNCTION notify_ai_agents_changed() RETURNS trigger AS $$
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
  IF to_regclass('public.ai_agents') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS ai_agents_notify_trigger ON ai_agents;
    CREATE TRIGGER ai_agents_notify_trigger
      AFTER INSERT OR UPDATE OR DELETE ON ai_agents
      FOR EACH ROW EXECUTE FUNCTION notify_ai_agents_changed();
  END IF;
END $$;
`;

export interface AiAgentSyncOptions {
  /** Called on any agent change so the cached set can be cleared/reloaded. */
  onChanged: () => Promise<void> | void;
  /** Called after a (re)connect to drop the whole cache (changes may be missed). */
  onReconnect?: () => Promise<void> | void;
}

/**
 * Keeps the media runtime's in-memory AI-agent cache in sync with the shared
 * Postgres table the Go API owns. Same dedicated-LISTEN-client, self-healing
 * pattern as the other *SyncListeners (WebhookSync / RoutingRuleSync / ...).
 */
export class AiAgentSyncListener extends PgNotifyListener {
  protected readonly channel = CHANNEL;
  protected get label(): string {
    return 'ai-agent-sync';
  }

  constructor(private opts: AiAgentSyncOptions) {
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
      console.warn(`⚠️  ai-agent-sync invalidate failed: ${err?.message}`);
    }
  }
}
