import { CallLog, SipUser } from './types';

export interface AppConfig {
  server: {
    httpPort: number;
    wsPort: number;
    publicIp: string;
    domain: string;
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
  sipUsers: Array<{ extension: string; username: string; password: string; name: string }>;
}

export const config: AppConfig = {
  server: {
    httpPort: parseInt(process.env.HTTP_PORT || '3001'),
    wsPort: parseInt(process.env.WS_PORT || '3002'),
    publicIp: process.env.PUBLIC_IP || '127.0.0.1',
    domain: process.env.DOMAIN || 'localhost',
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
    listenAddress: process.env.FREESWITCH_LISTEN_ADDRESS || '172.21.0.1',
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
  sipUsers: [
    { extension: '1001', username: 'user1', password: 'pass123', name: 'Alice' },
    { extension: '1002', username: 'user2', password: 'pass123', name: 'Bob' },
    { extension: '1003', username: 'user3', password: 'pass123', name: 'Charlie' },
  ],
};
