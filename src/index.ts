import { config } from '@/core';
import { DatabaseService, TrunkService, createRegistrationStore } from '@/services';
import { SipServer } from '@/sip';
import { SignalingServer } from '@/websocket';
import { HttpServer } from '@/http';

class Application {
  private db: DatabaseService;
  private trunk: TrunkService;
  private sip: SipServer;
  private ws: SignalingServer;
  private http: HttpServer;

  constructor() {
    this.db = new DatabaseService();
    this.trunk = new TrunkService();
    const registrationStore = createRegistrationStore();
    this.sip = new SipServer(this.db, this.trunk, registrationStore);
    this.ws = new SignalingServer(this.db);
    this.http = new HttpServer(this.db, this.trunk, this.sip);
  }

  async start(): Promise<void> {
    console.log('🚀 CallNet API starting...');
    console.log(`   Domain: ${config.server.domain}`);
    console.log(`   HTTP:   :${config.server.httpPort}`);
    console.log(`   WS:     :${config.server.wsPort}`);
    console.log(`   Trunk:  ${config.trunk.enabled ? config.trunk.host : 'disabled'}`);
    console.log(`   IVR:    ${config.ivr.enabled ? 'enabled' : 'disabled'}`);

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
