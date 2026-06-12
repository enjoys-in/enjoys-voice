import { CallLog, SipUser } from './types';

export interface AppConfig {
  server: {
    httpPort: number;
    wsPort: number;
    publicIp: string;
    domain: string;
    publicWsUrl: string;
    publicSipWsUrl: string;
  };
  drachtio: {
    host: string;
    port: number;
    secret: string;
  };
  freeswitch: {
    host: string;
    port: number;
    secret: string;
    listenAddress: string;
    listenPort: number;
  };
  sipWs: {
    port: number;
  };
  trunk: {
    name: string;
    host: string;
    port: number;
    transport: 'udp' | 'tcp' | 'tls';
    username: string;
    password: string;
    callerNumber: string;
    enabled: boolean;
    prefix: string;
  };
  ivr: {
    enabled: boolean;
    entryExtension: string;
    businessHoursStart: number;
    businessHoursEnd: number;
    maxVoicemailSec: number;
    recordingsDir: string;
    defaultLanguage: 'en' | 'hi';
  };
  voicemail: {
    enabled: boolean;
    // Path FreeSWITCH writes recordings to (inside the FS container).
    fsDir: string;
    // Path the backend reads recordings from (shared volume / bind mount).
    hostDir: string;
    maxSec: number;
  };
  callRecording: {
    enabled: boolean;
    // Directory the backend writes client-uploaded call recordings to.
    hostDir: string;
  };
  sounds: {
    basePath: string;
    ringback: string;
    ringbackIn: string;
    callerTune: string;
    holdMusic: string;
  };
  sipUsers: Array<{ extension: string; username: string; password: string; name: string }>;
}

export const config: AppConfig = {
  server: {
    httpPort: parseInt(process.env.HTTP_PORT || '3001'),
    wsPort: parseInt(process.env.WS_PORT || '3002'),
    publicIp: process.env.PUBLIC_IP || '127.0.0.1',
    domain: process.env.DOMAIN || 'localhost',
    // Optional full-URL overrides for production (e.g. wss:// behind a TLS proxy).
    // When empty, legacy ws://<publicIp>:<port> URLs are used (local default).
    publicWsUrl: process.env.PUBLIC_WS_URL || '',
    publicSipWsUrl: process.env.PUBLIC_SIP_WS_URL || '',
  },
  drachtio: {
    host: process.env.DRACHTIO_HOST || '127.0.0.1',
    port: parseInt(process.env.DRACHTIO_PORT || '9022'),
    secret: process.env.DRACHTIO_SECRET || 'siprocks',
  },
  freeswitch: {
    host: process.env.FREESWITCH_HOST || '127.0.0.1',
    port: parseInt(process.env.FREESWITCH_PORT || '8021'),
    secret: process.env.FREESWITCH_SECRET || 'JambonzR0ck$',
    listenAddress: process.env.FREESWITCH_LISTEN_ADDRESS || 'host.docker.internal',
    listenPort: parseInt(process.env.FREESWITCH_LISTEN_PORT || '8085'),
  },
  sipWs: {
    port: parseInt(process.env.SIP_WS_PORT || '5065'),
  },
  trunk: {
    name: process.env.TRUNK_NAME || 'custom',
    host: process.env.TRUNK_HOST || '',
    port: parseInt(process.env.TRUNK_PORT || '5060'),
    transport: (process.env.TRUNK_TRANSPORT as 'udp' | 'tcp' | 'tls') || 'udp',
    username: process.env.TRUNK_USERNAME || '',
    password: process.env.TRUNK_PASSWORD || '',
    callerNumber: process.env.TRUNK_CALLER_NUMBER || '',
    enabled: !!process.env.TRUNK_HOST,
    prefix: process.env.TRUNK_PREFIX || '',
  },
  ivr: {
    enabled: process.env.IVR_ENABLED !== 'false',
    entryExtension: process.env.IVR_ENTRY || '5000',
    businessHoursStart: parseInt(process.env.BIZ_HOURS_START || '9'),
    businessHoursEnd: parseInt(process.env.BIZ_HOURS_END || '18'),
    maxVoicemailSec: parseInt(process.env.MAX_VOICEMAIL_SEC || '180'),
    recordingsDir: process.env.RECORDINGS_DIR || '/usr/local/freeswitch/recordings',
    defaultLanguage: (process.env.IVR_DEFAULT_LANG || 'en') as 'en' | 'hi',
  },
  voicemail: {
    enabled: process.env.VOICEMAIL_ENABLED !== 'false',
    fsDir: process.env.VOICEMAIL_FS_DIR || '/usr/local/freeswitch/recordings/voicemail',
    hostDir: process.env.VOICEMAIL_HOST_DIR || 'docker/recordings/voicemail',
    maxSec: parseInt(process.env.MAX_VOICEMAIL_SEC || '180'),
  },
  callRecording: {
    enabled: process.env.CALL_RECORDING_ENABLED !== 'false',
    hostDir: process.env.CALL_RECORDING_HOST_DIR || 'docker/recordings/calls',
  },
  sounds: {
    basePath: process.env.SOUNDS_PATH || '/usr/share/freeswitch/sounds',
    ringback: process.env.RINGBACK_FILE || '/usr/share/freeswitch/sounds/ringtones/ringback.wav',
    ringbackIn: process.env.RINGBACK_IN_FILE || '/usr/share/freeswitch/sounds/ringtones/ringback_in.wav',
    callerTune: process.env.CALLER_TUNE_FILE || '/usr/share/freeswitch/sounds/ringtones/caller_tune.wav',
    holdMusic: process.env.HOLD_MUSIC_FILE || '/usr/share/freeswitch/sounds/music/hold_music_1.wav',
  },
  sipUsers: [
    { extension: '1001', username: 'user1', password: 'pass123', name: 'Alice' },
    { extension: '1002', username: 'user2', password: 'pass123', name: 'Bob' },
    { extension: '1003', username: 'user3', password: 'pass123', name: 'Charlie' },
  ],
};
