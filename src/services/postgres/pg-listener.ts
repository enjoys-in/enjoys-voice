import { Client } from 'pg';
import { config } from '@/core';

/**
 * Base class for a self-healing Postgres LISTEN/NOTIFY consumer.
 *
 * Owns a DEDICATED long-lived client (LISTEN cannot run on a pooled connection
 * that gets handed to other queries) and auto-reconnects with exponential
 * backoff. On every (re)connect it runs `installSql()` (idempotent — typically a
 * trigger install), LISTENs on `channel`, then calls `onConnected()` so the
 * subclass can re-hydrate to catch any NOTIFYs emitted while it was disconnected
 * (notifications are not queued for offline listeners). This makes every
 * listener self-healing even if it starts before the table/trigger exist.
 *
 * Subclasses provide the channel, the install SQL and the payload handler; the
 * connect / reconnect / backoff lifecycle lives here once, shared by the
 * user-sync and settings-sync listeners.
 */
export abstract class PgNotifyListener {
  private client: Client | null = null;
  private stopped = false;
  private reconnectDelayMs = 1000;
  private readonly maxReconnectDelayMs = 30000;

  /** NOTIFY channel this listener subscribes to. */
  protected abstract readonly channel: string;
  /** Human-friendly label for log lines (defaults to the channel name). */
  protected get label(): string {
    return this.channel;
  }

  /** Idempotent SQL run on every (re)connect — usually a trigger (re)install. */
  protected abstract installSql(): string;

  /** Reconcile one change from a NOTIFY payload. */
  protected abstract handlePayload(payload?: string): Promise<void> | void;

  /** Optional hook after a (re)connect to catch changes missed while offline. */
  protected onConnected(): Promise<void> | void {
    /* default no-op */
  }

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
      console.warn(`⚠️  ${this.label} listener error: ${err.message}`);
      this.scheduleReconnect();
    });
    client.on('end', () => this.scheduleReconnect());
    client.on('notification', (msg) => void this.handlePayload(msg.payload));

    try {
      await client.connect();
      await client.query(this.installSql());
      await client.query(`LISTEN ${this.channel}`);
      this.reconnectDelayMs = 1000; // reset backoff on a clean connect
      console.log(`✅ DB: ${this.label} listening on "${this.channel}"`);
      // Catch anything that changed before we (re)connected.
      await this.onConnected();
    } catch (err: any) {
      console.warn(`⚠️  ${this.label} connect failed: ${err?.message}`);
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
}
