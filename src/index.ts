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
  ConnectorSyncListener,
  IvrFlowSyncListener,
  RoutingRuleSyncListener,
  WebhookSyncListener,
  WebhookDispatcher,
  deliverWebhook,
  AiAgentSyncListener,
  RatingService,
  WriteQueue,
  ensureCallSchema,
  upsertCall,
  debitForCall,
  ConferenceService,
  QueueService,
  ApiKeyService,
} from '@/services';
import { SipServer } from '@/sip';
import { SignalingServer } from '@/websocket';
import { HttpServer } from '@/http';
import { createTrunkProvider, type ITrunkProvider, type TrunkProviderName } from '@/trunk';
import {
  streamingConfig,
  createMediaStreamRuntime,
  type MediaStreamRuntime,
  type AgentRuntimeConfig,
  type SttProvider,
  type LlmProvider,
  type TtsProvider,
} from '@/trunk/streaming';
import {
  AvailabilityService,
  BusinessHoursService,
  DatabasePresenceProvider,
  PgAvailabilityRepository,
  PgBusinessHoursRepository,
  PgPromptRepository,
  PgUserProfileRepository,
  PresenceService,
  RoutingDecisionEngine,
  RoutingOrchestrator,
  RoutingPolicyService,
} from '@/modules/routing';

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
  private connectorSync: ConnectorSyncListener;
  private ivrFlowSync: IvrFlowSyncListener;
  private routingSync: RoutingRuleSyncListener;
  private webhookSync: WebhookSyncListener;
  private webhookDispatcher: WebhookDispatcher;
  private aiAgentSync: AiAgentSyncListener;
  private rating: RatingService;
  private writeQueue: WriteQueue;
  private conference: ConferenceService;
  private queue: QueueService;
  private apiKeys: ApiKeyService;
  private routing: RoutingOrchestrator;

  constructor() {
    this.db = new DatabaseService();
    this.trunk = new TrunkService();
    // PSTN provider (REST Voice API + media streaming) selected by
    // SIP_TRUNK_PROVIDER (twilio|plivo|telnyx|vonage); configured from that
    // provider's *_* env. `isEnabled` stays false until its credentials are set,
    // so this is inert until configured. Runs ALONGSIDE the legacy SIP
    // TrunkService — it does not replace it.
    const trunkProviderName = (process.env.SIP_TRUNK_PROVIDER || 'twilio') as TrunkProviderName;
    this.twilioTrunk = createTrunkProvider(trunkProviderName);
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
    // Shared call-queue / ACD registry. The SIP path drives caller/agent state
    // from the media leg; the signaling server reads snapshots and toggles
    // agent availability. Agent presence is resolved from the registration
    // store via DatabaseService, with display names where known.
    this.queue = new QueueService(config.queue.definitions);
    this.queue.setPresenceProvider(
      (ext) => this.db.isRegistered(ext),
      (ext) => this.db.getUser(ext)?.name,
    );
    // Reusable routing module (business-hours + per-user schedule + presence).
    // Built before the SIP server so it can be injected; the internal extension
    // path consults it (phase 3) while every other path is untouched. With no
    // schedule configured the orchestrator reports open/available, so behavior
    // is unchanged until an admin defines hours.
    const availabilityRepo = new PgAvailabilityRepository();
    const businessHoursRepo = new PgBusinessHoursRepository();
    const userProfileRepo = new PgUserProfileRepository();
    const presenceProvider = new DatabasePresenceProvider(this.db);
    const availabilityService = new AvailabilityService(availabilityRepo);
    const businessHoursService = new BusinessHoursService(businessHoursRepo);
    const presenceService = new PresenceService(presenceProvider);
    const policyService = new RoutingPolicyService(availabilityService, businessHoursService, presenceService);
    const decisionEngine = new RoutingDecisionEngine();
    const promptRepo = new PgPromptRepository();
    this.routing = new RoutingOrchestrator(policyService, decisionEngine, userProfileRepo, promptRepo);
    this.sip = new SipServer(this.db, this.trunk, registrationStore, this.audit, this.conference, this.queue, this.routing);
    this.ws = new SignalingServer(this.db);
    this.ws.setConferenceService(this.conference);
    this.ws.setQueueService(this.queue);
    // Re-broadcast the live roster to a room's participants whenever it changes,
    // and tell everyone when a room closes (host left / emptied).
    this.conference.on('updated', (roomId: string) => this.ws.broadcastConferenceRoster(roomId));
    this.conference.on('closed', (roomId: string) => this.ws.broadcastConferenceClosed(roomId));
    // Push a fresh queue snapshot to subscribed dashboards/agents on any change.
    this.queue.on('updated', (queueId: string) => this.ws.broadcastQueueSnapshot(queueId));
    // Stream live metric snapshots to subscribed dashboard clients, and let the
    // WS serve the current snapshot on subscribe.
    this.ws.setMetricsProvider(() => this.metrics.getSnapshot());
    this.metrics.on('snapshot', (s) => this.ws.broadcastMetrics(s));
    // Stream live audit events to subscribed admin dashboards, and serve the
    // recent in-memory entries on subscribe (history-then-live).
    this.ws.setAuditProvider(() => this.audit.getAll(50));
    this.audit.on('entry', (e) => this.ws.broadcastAuditEntry(e));
    // Developer API keys for the embeddable click-to-call widget. Validates a
    // publishable key against its Origin/IP allow-list (HTTP) and mints the
    // short-lived capability token the browser puts in its INVITE.
    this.apiKeys = new ApiKeyService();
    this.http = new HttpServer(this.db, this.trunk, this.sip, this.twilioTrunk, this.metrics, this.apiKeys);
    // Twilio media-streaming WS server (separate port, like SignalingServer). Its
    // HTTP voice webhook rides on the existing HttpServer above. Opt-in via
    // MEDIA_STREAM_ENABLED; MEDIA_STREAM_MODE selects log|bridge|ai. The voice
    // agent is resolved per-call from the `agentId` stream parameter, so each
    // DID/IVR/rule can answer with its own configured agent (falls back to the
    // env-default brain when no agent is selected or it can't be loaded).
    if (streamingConfig.enabled) {
      this.media = createMediaStreamRuntime({
        resolveAgent: (agentId) => this.resolveAgentConfig(agentId),
      });
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
    // Live-reconcile email/webhook connectors the moment they're created/edited/
    // deleted in the dashboard (written by the Go API), so the IVR `email` block
    // always sends with current SMTP settings without a restart. Per-id
    // invalidation on change; full clear on reconnect to catch missed NOTIFYs.
    this.connectorSync = new ConnectorSyncListener({
      onConnectorChanged: (id) => this.db.invalidateConnector(id),
      onReconnect: () => this.db.clearConnectorCache(),
    });
    // Live-reconcile IVR-flow ROUTING the moment a flow is created/edited/
    // enabled/disabled/deleted in the builder (written by the Go API). The SIP
    // path keeps only the small Set of enabled flow ENTRY EXTENSIONS in memory
    // (just strings, not graphs — graphs load lazily on first call); a change
    // fetches that one row and merges it, so a new flow becomes dialable WITHOUT
    // a restart. onReconnect re-hydrates to catch changes missed while down.
    this.ivrFlowSync = new IvrFlowSyncListener({
      onFlowChanged: (ext) => this.db.syncIvrFlowExtension(ext),
      onReconnect: async () => {
        this.db.clearIvrFlowCache();
        await this.db.hydrateIvrFlowExtensions();
      },
    });
    // Live-reconcile per-user inbound routing rules the moment a user creates/
    // edits/deletes one in the dashboard (written by the Go API), so the SIP
    // path always decides from memory and never reads the DB per call. A single
    // edit can move a rule's match key, so the whole (small) cache is cleared on
    // any change and on reconnect to catch missed NOTIFYs.
    this.routingSync = new RoutingRuleSyncListener({
      onChanged: () => this.db.clearRoutingRuleCache(),
      onReconnect: () => this.db.clearRoutingRuleCache(),
    });
    // Live-reconcile per-user outbound webhooks the moment one is created/
    // edited/deleted in the dashboard (written by the Go API). The whole (small)
    // enabled set is cached grouped by owner, so any change clears it and the
    // next call event lazily reloads it.
    this.webhookSync = new WebhookSyncListener({
      onChanged: () => this.db.clearWebhookCache(),
      onReconnect: () => this.db.clearWebhookCache(),
    });
    // Live-reconcile per-user AI voice agents the moment one is created/edited/
    // deleted in the dashboard (written by the Go API), so a call always builds
    // its brain from current config. Per-id + per-owner caches are small, so any
    // change clears the whole agent cache and the next call lazily reloads it.
    this.aiAgentSync = new AiAgentSyncListener({
      onChanged: () => this.db.clearAiAgentCache(),
      onReconnect: () => this.db.clearAiAgentCache(),
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
    // Per-user webhooks: a signed HTTP POST on call events. The dispatcher taps
    // the same CallUpserted choke point and enqueues one delivery job per
    // matching webhook; the queue worker performs the actual (signed, timed-out,
    // retried) POST, so a slow receiver never blocks the SIP/call path.
    this.writeQueue.on(WriteJob.WebhookDeliver, (job) => deliverWebhook(job));
    this.webhookDispatcher = new WebhookDispatcher({
      db: this.db,
      audit: this.audit,
      enqueue: (type, payload) => this.writeQueue.enqueue(type, payload),
    });
    this.webhookDispatcher.attach();
  }

  async start(): Promise<void> {
    console.log('🚀 CallNet API starting...');
    console.log(`   Domain: ${config.server.domain}`);
    console.log(`   HTTP:   :${config.server.httpPort}`);
    console.log(`   WS:     :${config.server.wsPort}`);
    console.log(`   Trunk:  ${config.trunk.enabled ? config.trunk.host : 'disabled'}`);
    console.log(
      `   PSTN:   ${this.twilioTrunk ? `${this.twilioTrunk.name} (${this.twilioTrunk.isEnabled ? 'enabled' : 'disabled'})` : 'disabled'}`,
    );
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
    // And for email/webhook connectors used by the IVR `email` block.
    this.connectorSync.start().catch((err: any) =>
      console.warn(`   Sync:   ⚠️  connector-sync listener failed to start (${err?.message})`),
    );
    // And for IVR flows: a flow created/enabled in the builder becomes dialable
    // immediately (no restart). Best-effort: no-ops until the table exists.
    this.ivrFlowSync.start().catch((err: any) =>
      console.warn(`   Sync:   ⚠️  ivr-flow-sync listener failed to start (${err?.message})`),
    );
    // And for per-user inbound routing rules (route inbound calls to an IVR,
    // extension, PSTN number, or voicemail).
    this.routingSync.start().catch((err: any) =>
      console.warn(`   Sync:   ⚠️  routing-rule-sync listener failed to start (${err?.message})`),
    );
    // And for per-user outbound call-event webhooks (a signed POST on call
    // events). Best-effort: a failure here just means no webhook deliveries.
    this.webhookSync.start().catch((err: any) =>
      console.warn(`   Sync:   ⚠️  webhook-sync listener failed to start (${err?.message})`),
    );
    // And for per-user AI voice agents (configurable STT/LLM/TTS). Best-effort:
    // if the ai_agents table doesn't exist yet, the listener no-ops and calls
    // fall back to the env-default brain.
    this.aiAgentSync.start().catch((err: any) =>
      console.warn(`   Sync:   ⚠️  ai-agent-sync listener failed to start (${err?.message})`),
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

  /**
   * Resolve a stream `agentId` parameter to a runtime brain config. Reads the
   * per-id AI-agent cache (negative-cached + LISTEN/NOTIFY-invalidated), so the
   * media path never touches Postgres per call. Returns undefined for an unknown
   * / disabled / malformed id, in which case the runtime uses its default brain.
   */
  private async resolveAgentConfig(agentId: string): Promise<AgentRuntimeConfig | undefined> {
    const id = Number(agentId);
    if (!Number.isFinite(id) || id <= 0) return undefined;
    const a = await this.db.getAiAgent(id);
    if (!a) return undefined;
    return {
      id: a.id,
      name: a.name,
      greeting: a.greeting,
      language: a.language,
      stt: { provider: a.sttProvider as SttProvider },
      llm: {
        provider: a.llmProvider as LlmProvider,
        model: a.llmModel,
        systemPrompt: a.systemPrompt,
        temperature: a.temperature,
      },
      tts: { provider: a.ttsProvider as TtsProvider, voice: a.ttsVoice },
    };
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
