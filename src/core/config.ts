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
  auth: {
    // Shared HS256 secret + issuer — MUST match the Go API (JWT_SECRET / JWT_ISSUER)
    // so the signaling WS can verify the access token the Go API issued.
    jwtSecret: string;
    jwtIssuer: string;
    // Origins permitted to open the signaling WebSocket (CSWSH defense). When
    // empty, localhost/127.0.0.1 on any port is allowed for local dev.
    allowedOrigins: string[];
  };
  database: {
    // Postgres connection string for the SHARED database the Go API owns. Node
    // hydrates its in-memory store from here so both processes see one source
    // of truth. MUST match the Go API's DATABASE_URL.
    url: string;
  };
  redis: {
    // Valkey/Redis connection used for the write-behind queue (and registration
    // store). Redis-protocol compatible (Redis, Valkey, Dragonfly). When the
    // server is unreachable, queued writes are skipped best-effort.
    url: string;
  };
  audit: {
    // When false, audit logging is a complete no-op: log() never buffers in
    // memory and nothing is written to the DB. Must be explicitly enabled.
    enabled: boolean;
    // How often (ms) the in-memory audit buffer is flushed to the shared
    // Postgres audit_logs table that the Go API reads.
    flushIntervalMs: number;
  };
}

// ─── Recordings base dirs ────────────────────────────────────────────────
// FreeSWITCH (in Docker) writes to the CONTAINER base; the host sees the SAME
// files through the compose bind mount (docker/docker-compose.yml):
//   ./recordings  :  /usr/local/freeswitch/recordings   (host : container)
// Only these TWO bases ever change to relocate recordings; the `voicemail/` and
// `calls/` subdirs are fixed conventions shared by FreeSWITCH and the API, so
// the file FreeSWITCH writes is exactly the file Node reads back and serves.
const FS_RECORDINGS_DIR = process.env.FS_RECORDINGS_DIR || '/usr/local/freeswitch/recordings'; // container (FS write side)
const HOST_RECORDINGS_DIR = process.env.RECORDINGS_DIR || 'docker/recordings';                  // host (API read side)

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
    recordingsDir: FS_RECORDINGS_DIR,
    defaultLanguage: (process.env.IVR_DEFAULT_LANG || 'en') as 'en' | 'hi',
  },
  voicemail: {
    enabled: process.env.VOICEMAIL_ENABLED !== 'false',
    // Container path FreeSWITCH records to (where the `record` app writes).
    fsDir: process.env.VOICEMAIL_FS_DIR || `${FS_RECORDINGS_DIR}/voicemail`,
    // Host path Node reads from / serves at /api/n/voicemails/:ext/:id/audio.
    hostDir: process.env.VOICEMAIL_HOST_DIR || `${HOST_RECORDINGS_DIR}/voicemail`,
    maxSec: parseInt(process.env.MAX_VOICEMAIL_SEC || '180'),
  },
  callRecording: {
    enabled: process.env.CALL_RECORDING_ENABLED !== 'false',
    hostDir: process.env.CALL_RECORDING_HOST_DIR || `${HOST_RECORDINGS_DIR}/calls`,
  },
  sounds: {
    basePath: process.env.SOUNDS_PATH || '/usr/share/freeswitch/sounds',
    ringback: process.env.RINGBACK_FILE || '/usr/share/freeswitch/sounds/ringtones/ringback.wav',
    ringbackIn: process.env.RINGBACK_IN_FILE || '/usr/share/freeswitch/sounds/ringtones/ringback_in.wav',
    callerTune: process.env.CALLER_TUNE_FILE || '/usr/share/freeswitch/sounds/ringtones/caller_tune.wav',
    // local_stream://moh is the standard FreeSWITCH music-on-hold stream
    // (configured in local_stream.conf.xml -> music/8000). It exists and loops
    // forever, unlike a single hard-coded WAV that may be missing.
    holdMusic: process.env.HOLD_MUSIC_FILE || 'local_stream://moh',
  },
  auth: {
    jwtSecret: process.env.JWT_SECRET || 'enjoys-voice-secret-change-me',
    jwtIssuer: process.env.JWT_ISSUER || 'enjoys-voice',
    allowedOrigins: (process.env.ALLOWED_ORIGINS || '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
  },
  database: {
    url:
      process.env.DATABASE_URL ||
      'postgres://postgres:postgres@localhost:5432/postgres?sslmode=disable',
  },
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },
  audit: {
    enabled: process.env.AUDIT_LOG === 'true',
    flushIntervalMs: parseInt(process.env.AUDIT_FLUSH_MS || '30000'),
  },
};
