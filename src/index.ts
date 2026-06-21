import { config, DbEvent, WriteJob } from '@/core';
import {
  DatabaseService,
  TrunkService,
  AuditService,
  CallMetricsService,
  createRegistrationStore,
  UserSyncListener,
  SettingsSyncListener,
  RateSyncListener,
  RatingService,
  WriteQueue,
  ensureCallSchema,
  upsertCall,
  debitForCall,
  ConferenceService,
} from '@/services';
import { SipServer } from '@/sip';
import { SignalingServer } from '@/websocket';
import { HttpServer } from '@/http';
import { createTrunkProvider, type ITrunkProvider } from '@/trunk';
import {
  streamingConfig,
  createMediaStreamRuntime,
  type MediaStreamRuntime,
} from '@/trunk/streaming';

class Application {
  private db: DatabaseService;
  private trunk: TrunkService;
  private twilioTrunk?: ITrunkProvider;
  private audit: AuditService;
  private metrics: CallMetricsService;
  private sip: SipServer;
  private ws: SignalingServer;
  private http: HttpServer;
  private media?: MediaStreamRuntime;
  private userSync: UserSyncListener;
  private settingsSync: SettingsSyncListener;
  private rateSync: RateSyncListener;
  private rating: RatingService;
  private writeQueue: WriteQueue;
  private conference: ConferenceService;

  constructor() {
    this.db = new DatabaseService();
    this.trunk = new TrunkService();
    // Twilio PSTN provider (REST Voice API + media streaming). Configured from
    // TWILIO_* env; `isEnabled` is false until credentials are set. Runs
    // ALONGSIDE the legacy SIP TrunkService — it does not replace it.
    this.twilioTrunk = createTrunkProvider('twilio');
    this.audit = new AuditService();
    // Call-rating engine: prices billable (external) calls at end-of-call using
    // the workspace rate plans. Injected into the DatabaseService so cost is
    // stamped at the single `ended` choke point, before the record is mirrored
    // to Postgres.
    this.rating = new RatingService();
    this.db.setRater(this.rating);
    // Live call-concurrency / CPS tracker for the admin dashboard. Listens to
    // the DatabaseService's CallUpserted event, so it sees every call leg
    // without per-handler hooks.
    this.metrics = new CallMetricsService(this.db);
    const registrationStore = createRegistrationStore();
    // Shared multi-party conference registry. The SIP path writes join/leave
    // from the media leg; the signaling server reads the roster and sends
    // invites. A single instance is shared by both so they stay in lock-step.
    this.conference = new ConferenceService();
    this.sip = new SipServer(this.db, this.trunk, registrationStore, this.audit, this.conference);
    this.ws = new SignalingServer(this.db);
    this.ws.setConferenceService(this.conference);
    // Re-broadcast the live roster to a room's participants whenever it changes,
    // and tell everyone when a room closes (host left / emptied).
    this.conference.on('updated', (roomId: string) => this.ws.broadcastConferenceRoster(roomId));
    this.conference.on('closed', (roomId: string) => this.ws.broadcastConferenceClosed(roomId));
    // Stream live metric snapshots to subscribed dashboard clients, and let the
    // WS serve the current snapshot on subscribe.
    this.ws.setMetricsProvider(() => this.metrics.getSnapshot());
    this.metrics.on('snapshot', (s) => this.ws.broadcastMetrics(s));
    // Stream live audit events to subscribed admin dashboards, and serve the
    // recent in-memory entries on subscribe (history-then-live).
    this.ws.setAuditProvider(() => this.audit.getAll(50));
    this.audit.on('entry', (e) => this.ws.broadcastAuditEntry(e));
    this.http = new HttpServer(this.db, this.trunk, this.sip, this.twilioTrunk, this.metrics);
    // Twilio media-streaming WS server (separate port, like SignalingServer). Its
    // HTTP voice webhook rides on the existing HttpServer above. Opt-in via
    // MEDIA_STREAM_ENABLED; MEDIA_STREAM_MODE selects log|bridge|ai.
    if (streamingConfig.enabled) {
      this.media = createMediaStreamRuntime();
    }
    // Keep the in-memory user store in sync with Postgres in near real time:
    // any account created/edited/deleted via the Go API is reconciled here
    // without a restart. onReconnect re-hydrates to catch changes missed while
    // the listener was disconnected.
    this.userSync = new UserSyncListener({
      onUserChanged: (ext) => this.db.syncUser(ext),
      onReconnect: async () => {
        await this.db.hydrateFromPostgres();
      },
    });
    // Live-reconcile per-user routing settings (block list, call forwarding, PSTN
    // forwarding) the moment they change in the dashboard (written by the Go API),
    // so the SIP path always decides from memory and never reads the DB per call.
    // hydrateUserDetail refreshes exactly that one user's three settings tables.
    this.settingsSync = new SettingsSyncListener({
      onSettingsChanged: (ext) => this.db.hydrateUserDetail(ext),
      onReconnect: async () => {
        await this.db.hydrateFromPostgres();
      },
    });
    // Live-reconcile the rate book (rate plans + rates) the moment an admin
    // edits pricing via the Go API. onConnected does the initial load, so a full
    // reload runs on first connect and after any reconnect — keeping in-memory
    // pricing current without a restart.
    this.rateSync = new RateSyncListener({
      onRatesChanged: async () => {
        await this.rating.reload();
      },
    });
    // Write-behind queue: call-record upserts are emitted as events, enqueued to
    // Valkey, and applied to the shared Postgres by a worker. This keeps the SIP
    // path off the DB write latency. (Voicemails write to Postgres directly.)
    this.writeQueue = new WriteQueue();
    this.writeQueue.on(WriteJob.CallUpsert, (call) => upsertCall(call));
    this.db.on(DbEvent.CallUpserted, (call) => {
      void this.writeQueue.enqueue(WriteJob.CallUpsert, call).catch(() => {});
    });
    // Prepaid wallet debits: priced at end-of-call, applied to Postgres by the
    // queue worker (atomic + idempotent on the call id). Only emitted when
    // prepaid billing is on, so this is inert otherwise.
    this.writeQueue.on(WriteJob.BalanceDebit, (job) => debitForCall(job));
    this.db.on(DbEvent.BalanceDebit, (job) => {
      void this.writeQueue.enqueue(WriteJob.BalanceDebit, job).catch(() => {});
    });
  }

  async start(): Promise<void> {
    console.log('🚀 CallNet API starting...');
    console.log(`   Domain: ${config.server.domain}`);
    console.log(`   HTTP:   :${config.server.httpPort}`);
    console.log(`   WS:     :${config.server.wsPort}`);
    console.log(`   Trunk:  ${config.trunk.enabled ? config.trunk.host : 'disabled'}`);
    console.log(`   Twilio: ${this.twilioTrunk?.isEnabled ? 'enabled' : 'disabled'}`);
    console.log(
      `   Media:  ${this.media ? `enabled (${this.media.mode}, ws :${streamingConfig.wsPort})` : 'disabled'}`,
    );
    console.log(`   IVR:    ${config.ivr.enabled ? 'enabled' : 'disabled'}`);

    // Hydrate users from the shared Postgres DB so accounts created via the Go
    // API can register and be called. Best-effort: if the DB is unreachable we
    // keep the in-memory seed so local dev still boots.
    try {
      const n = await this.db.hydrateFromPostgres();
      console.log(`   Users:  hydrated ${n} from Postgres`);
    } catch (err: any) {
      console.warn(`   Users:  ⚠️  Postgres hydration failed, using in-memory seed (${err?.message})`);
    }

    // Start syncing user changes from Postgres (LISTEN/NOTIFY). Self-healing and
    // best-effort — a failure here must not stop the SIP/WS/HTTP servers.
    this.userSync.start().catch((err: any) =>
      console.warn(`   Sync:   ⚠️  user-sync listener failed to start (${err?.message})`),
    );
    // Same LISTEN/NOTIFY mechanism for per-user settings (block/forward/PSTN).
    this.settingsSync.start().catch((err: any) =>
      console.warn(`   Sync:   ⚠️  settings-sync listener failed to start (${err?.message})`),
    );
    // And for the billing rate book. Best-effort: if it can't start (or billing
    // tables don't exist yet), calls simply go unrated (cost 0).
    this.rateSync.start().catch((err: any) =>
      console.warn(`   Sync:   ⚠️  rate-sync listener failed to start (${err?.message})`),
    );

    // Start the write-behind queue worker (voicemail → Postgres). Best-effort:
    // if Valkey is unreachable, voicemails still record (in memory + on disk),
    // they just aren't mirrored to the shared DB until it recovers.
    try {
      await ensureCallSchema();
      const n = await this.db.hydrateCallsFromPostgres();
      console.log(`   Calls:  hydrated ${n} recents from Postgres`);
    } catch (err: any) {
      console.warn(`   Calls:  ⚠️  call_records schema/hydrate failed (${err?.message})`);
    }
    this.writeQueue.start().catch((err: any) =>
      console.warn(`   Queue:  ⚠️  write queue failed to start (${err?.message})`),
    );

    // Periodic audit-log flush → shared Postgres. Disabled unless AUDIT_LOG=true,
    // in which case events are buffered in memory and flushed on an interval.
    this.audit.start();
    console.log(
      `   Audit:  ${config.audit.enabled ? `enabled (flush ${config.audit.flushIntervalMs / 1000}s)` : 'disabled'}`,
    );

    // Wire SIP call events → WebSocket notifications
    this.sip.setNotifier((ext, event, data) => this.ws.notifyCallEvent(ext, event, data));

    // Begin the live-metrics heartbeat (dashboard concurrency/CPS feed).
    this.metrics.start();

    await this.sip.start();
    this.ws.start();
    this.http.start();
    this.media?.start();
  }

  /** Best-effort graceful shutdown: persist any buffered audit events before exit. */
  async shutdown(): Promise<void> {
    this.media?.stop();
    this.metrics.stop();
    await this.audit.stop();
  }
}

const app = new Application();
app.start().catch((err) => {
  console.error('❌ Fatal:', err);
  process.exit(1);
});

// Flush buffered audit events on a clean stop (SIGINT/SIGTERM). bun --watch and
// container kills may use SIGKILL, which can't be trapped — flushing is
// best-effort, and the periodic timer bounds any loss to one interval.
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.once(sig, () => {
    void app.shutdown().finally(() => process.exit(0));
  });
}
