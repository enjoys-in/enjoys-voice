// Shared domain types and the minimal ESL surface this app depends on. Modeling
// only what we use keeps us decoupled from modesl's loosely-typed API.

export interface EslEvent {
  getBody(): string;
  getHeader(name: string): string | null;
}

export interface EslConnection {
  execute(app: string, arg?: string, cb?: (evt: EslEvent) => void): void;
  api(cmd: string, cb?: (evt: EslEvent) => void): void;
  getInfo(): EslEvent;
  on(event: string, cb: (...args: unknown[]) => void): void;
}

export type AudioChannels = 'mono' | 'mixed' | 'stereo';

export interface AppConfig {
  http: {
    port: number;
    publicDir: string;
  };
  ws: {
    port: number;
    /** Hostname FreeSWITCH dials to reach this app over the Docker network. */
    hostForFreeswitch: string;
  };
  esl: {
    port: number;
  };
  audio: {
    channels: AudioChannels;
    sampleRate: number;
    bitDepth: number;
    /** mod_audio_stream emits native-endian (LE) L16; only enable a swap if a
     *  particular build/host delivers big-endian frames (recording sounds like
     *  static). Default off. */
    swapEndianness: boolean;
  };
  recording: {
    enabled: boolean;
    dir: string;
    /** When the stream is stereo, average L+R into one centered mono track so the
     *  AI isn't isolated to one channel. STT can still use the raw stereo frames. */
    downmix: boolean;
  };
  tts: {
    voice: string;
    greeting: string;
  };
}
