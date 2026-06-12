import { config } from '@/core';
import { DatabaseService, TrunkService, AuditService, createRegistrationStore } from '@/services';
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

  constructor() {
    this.db = new DatabaseService();
    this.trunk = new TrunkService();
    this.audit = new AuditService();
    const registrationStore = createRegistrationStore();
    this.sip = new SipServer(this.db, this.trunk, registrationStore, this.audit);
    this.ws = new SignalingServer(this.db);
    this.http = new HttpServer(this.db, this.trunk, this.sip, this.audit);
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
