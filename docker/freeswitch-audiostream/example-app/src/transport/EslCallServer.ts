import { Server as EslServer } from 'modesl';
import type { IServer, ILogger } from '@/core/interfaces';
import type { AppConfig, EslConnection } from '@/core/types';
import type { CallController } from '@/application/CallController';

// Outbound Event Socket server. FreeSWITCH connects here (per the dialplan
// `socket` app) when a call hits our extension; each ready connection is handed
// to the CallController, which owns the call flow. This class only deals with
// the ESL transport — Single Responsibility.
export class EslCallServer implements IServer {
  private server?: EslServer;

  constructor(
    private readonly config: AppConfig,
    private readonly controller: CallController,
    private readonly logger: ILogger
  ) {}

  start(): void {
    this.server = new EslServer(
      { host: '0.0.0.0', port: this.config.esl.port, myevents: true },
      () => this.logger.info(`Outbound call control on port ${this.config.esl.port}`)
    );

    this.server.on('error', (err: Error) => this.logger.error('Server error:', err?.message));
    this.server.on('connection::open', (_conn: unknown, id: string) =>
      this.logger.info(`Raw connection opened: ${id}`)
    );
    this.server.on('connection::ready', (conn: unknown) => {
      this.controller.handleConnection(conn as EslConnection);
    });
  }

  stop(): void {
    (this.server as unknown as { close?: () => void })?.close?.();
  }
}
