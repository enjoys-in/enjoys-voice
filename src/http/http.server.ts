import express, { Application } from 'express';
import cors from 'cors';
import { config } from '@/core';
import { DatabaseService, TrunkService, AuditService } from '@/services';
import { SipServer } from '@/sip';
import { createRoutes } from './routes/api.routes';
import { apiRateLimit } from './middleware/rate-limit';

export class HttpServer {
  private app: Application;

  constructor(
    private db: DatabaseService,
    private trunk: TrunkService,
    private sip: SipServer,
    private audit: AuditService,
  ) {
    this.app = express();
    this.configure();
  }

  private configure(): void {
    this.app.use(cors());
    this.app.use(express.json());
    this.app.use(apiRateLimit);
    this.app.use('/api', createRoutes(this.db, this.trunk, this.sip, this.audit));
  }

  start(): void {
    this.app.listen(config.server.httpPort, () => {
      console.log(`✅ HTTP: API server on port ${config.server.httpPort}`);
    });
  }
}
