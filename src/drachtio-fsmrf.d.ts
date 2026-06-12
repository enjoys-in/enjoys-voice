declare module 'drachtio-fsmrf' {
  import { Srf } from 'drachtio-srf';
  
  interface MediaServerConfig {
    address: string;
    port: number;
    secret: string;
    listenAddress?: string;
    listenPort?: number;
    advertisedAddress?: string;
    profile?: string;
  }

  interface Endpoint {
    play(soundFile: string): Promise<void>;
    recordSession(path: string): Promise<void>;
    startRecording(path: string): Promise<void>;
    stopRecording(): Promise<void>;
    record(path: string, opts?: Record<string, unknown>): Promise<void>;
    playCollect(opts: {
      file: string;
      min?: number;
      max?: number;
      tries?: number;
      timeout?: number;
      terminators?: string;
      invalidFile?: string;
      varName?: string;
      regexp?: string;
      digitTimeout?: number;
    }): Promise<{
      digits: string;
      invalidDigits?: string;
      terminatorUsed?: string;
      playbackSeconds?: string;
      playbackMilliseconds?: string;
    }>;
    execute(app: string, args?: string): Promise<any>;
    destroy(): void;
    on(event: string, handler: (...args: any[]) => void): void;
  }

  interface Dialog {
    sip: { callId: string };
    destroy(): void;
    on(event: string, handler: () => void): void;
  }

  interface MediaServer {
    connectCaller(req: any, res: any): Promise<{ endpoint: Endpoint; dialog: Dialog }>;
  }

  class Mrf {
    constructor(srf?: Srf);
    connect(config: MediaServerConfig): Promise<MediaServer>;
  }

  export = Mrf;
}
