import { config, DbEvent, WriteJob } from '@/core';
import {
  DatabaseService,
  TrunkService,
  AuditService,
  createRegistrationStore,
  UserSyncListener,
  WriteQueue,
  insertVoicemail,
  markVoicemailReadByFile,
  deleteVoicemailByFile,
  ensureCallSchema,
  upsertCall,
} from '@/services';
import { SipServer } from '@/sip';
import { SignalingServer } from '@/websocket';
import { HttpServer } from '@/http';

class Application {
  private db: DatabaseService;
  private trunk: TrunkService;
  private audit: AuditService;
  private sip: SipServer;
  private ws: SignalingServer;
  private http: HttpServer;
  private userSync: UserSyncListener;
  private writeQueue: WriteQueue;

  constructor() {
    this.db = new DatabaseService();
    this.trunk = new TrunkService();
    this.audit = new AuditService();
    const registrationStore = createRegistrationStore();
    this.sip = new SipServer(this.db, this.trunk, registrationStore, this.audit);
    this.ws = new SignalingServer(this.db);
    this.http = new HttpServer(this.db, this.trunk, this.sip, this.audit);
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
    // Write-behind queue: voicemail mutations are emitted as events, enqueued to
    // Valkey, and applied to the shared Postgres by a worker. This keeps the SIP
    // path off the DB write latency and shares voicemails with the Go dashboard.
    this.writeQueue = new WriteQueue();
    this.writeQueue
      .on(WriteJob.VoicemailCreate, (vm) => insertVoicemail(vm))
      .on(WriteJob.VoicemailRead, ({ extension, filename }) => markVoicemailReadByFile(extension, filename))
      .on(WriteJob.VoicemailDelete, ({ extension, filename }) => deleteVoicemailByFile(extension, filename))
      .on(WriteJob.CallUpsert, (call) => upsertCall(call));
    this.db.on(DbEvent.VoicemailCreated, (vm) => {
      void this.writeQueue.enqueue(WriteJob.VoicemailCreate, vm).catch(() => {});
    });
    this.db.on(DbEvent.VoicemailRead, (p) => {
      void this.writeQueue.enqueue(WriteJob.VoicemailRead, p).catch(() => {});
    });
    this.db.on(DbEvent.VoicemailDeleted, (p) => {
      void this.writeQueue.enqueue(WriteJob.VoicemailDelete, p).catch(() => {});
    });
    this.db.on(DbEvent.CallUpserted, (call) => {
      void this.writeQueue.enqueue(WriteJob.CallUpsert, call).catch(() => {});
    });
  }

  async start(): Promise<void> {
    console.log('🚀 CallNet API starting...');
    console.log(`   Domain: ${config.server.domain}`);
    console.log(`   HTTP:   :${config.server.httpPort}`);
    console.log(`   WS:     :${config.server.wsPort}`);
    console.log(`   Trunk:  ${config.trunk.enabled ? config.trunk.host : 'disabled'}`);
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

    // Start the write-behind queue worker (voicemail → Postgres). Best-effort:
    // if Valkey is unreachable, voicemails still record (in memory + on disk),
    // they just aren't mirrored to the shared DB until it recovers.
    try {
      await ensureCallSchema();
    } catch (err: any) {
      console.warn(`   Calls:  ⚠️  call_records schema ensure failed (${err?.message})`);
    }
    this.writeQueue.start().catch((err: any) =>
      console.warn(`   Queue:  ⚠️  write queue failed to start (${err?.message})`),
    );

    // Wire SIP call events → WebSocket notifications
    this.sip.setNotifier((ext, event, data) => this.ws.notifyCallEvent(ext, event, data));

    await this.sip.start();
    this.ws.start();
    this.http.start();
  }
}

const app = new Application();
app.start().catch((err) => {
  console.error('❌ Fatal:', err);
  process.exit(1);
});
