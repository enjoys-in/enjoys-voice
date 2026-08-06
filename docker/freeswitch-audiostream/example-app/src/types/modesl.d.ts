// Minimal ambient declarations for modesl (no official @types). Only the surface
// this app uses is typed; see @/core/types EslConnection for the connection API.
declare module 'modesl' {
  interface EslServerOptions {
    host?: string;
    port: number;
    myevents?: boolean;
  }

  export class Server {
    constructor(options: EslServerOptions, readyCallback?: () => void);
    on(event: string, listener: (...args: any[]) => void): this;
    close?(): void;
  }

  export class Connection {
    execute(app: string, arg?: string, cb?: (evt: any) => void): void;
    api(cmd: string, cb?: (evt: any) => void): void;
    getInfo(): any;
    on(event: string, listener: (...args: any[]) => void): void;
  }
}
