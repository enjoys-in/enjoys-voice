declare module 'drachtio-fsmrf' {
  import { Srf } from 'drachtio-srf';
  
  interface MediaServerConfig {
    address: string;
    port: number;
    secret: string;
  }

  interface Endpoint {
    play(soundFile: string): Promise<void>;
    recordSession(path: string): Promise<void>;
    startRecording(path: string): Promise<void>;
    stopRecording(): Promise<void>;
    waitForDtmf(timeout: number): Promise<{ dtmf: string }>;
    destroy(): void;
    on(event: string, handler: () => void): void;
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
