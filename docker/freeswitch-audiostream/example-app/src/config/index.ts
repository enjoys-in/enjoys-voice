import type { AppConfig, AudioChannels } from '@/core/types';

// Environment-driven configuration. Every value has a safe default so the app
// boots with zero config, yet each is overridable per environment (12-factor).

const int = (v: string | undefined, d: number): number =>
  v === undefined || v === '' ? d : Number.parseInt(v, 10);

const bool = (v: string | undefined, d: boolean): boolean =>
  v === undefined || v === '' ? d : /^(1|true|yes|on)$/i.test(v);

const str = (v: string | undefined, d: string): string =>
  v === undefined || v === '' ? d : v;

const channels = (v: string | undefined, d: AudioChannels): AudioChannels => {
  const val = (v ?? d).toLowerCase();
  return val === 'mixed' || val === 'stereo' ? (val as AudioChannels) : 'mono';
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    http: {
      port: int(env.HTTP_PORT, 3000),
      publicDir: str(env.PUBLIC_DIR, 'public'),
    },
    ws: {
      port: int(env.WS_PORT, 8080),
      hostForFreeswitch: str(env.WS_HOST_FOR_FS, 'node-app'),
    },
    esl: {
      port: int(env.ESL_PORT, 8085),
    },
    audio: {
      channels: channels(env.AUDIO_CHANNELS, 'mono'),
      sampleRate: int(env.AUDIO_SAMPLE_RATE, 8000),
      bitDepth: 16,
      swapEndianness: bool(env.AUDIO_SWAP_ENDIANNESS, false),
    },
    recording: {
      enabled: bool(env.RECORDING_ENABLED, true),
      dir: str(env.RECORDING_DIR, 'public'),
    },
    tts: {
      voice: str(env.TTS_VOICE, 'en_US-amy-medium'),
      greeting: str(
        env.TTS_GREETING,
        'Hello, welcome to the ENJOYS AI line by Mulayam. Please start speaking; I am listening.'
      ),
    },
  };
}

const config = loadConfig();
export default config;
