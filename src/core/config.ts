import { CallLog, SipUser } from './types';

/**
 * An approved external SIP peer an internal user may place calls to (SIP-to-SIP
 * federation). `host` is the ALLOWLIST KEY: it is matched against the inbound
 * INVITE's Request-URI host, so a user can only reach a pre-approved domain —
 * never an arbitrary one (no open relay / toll-fraud vector). The remaining
 * fields shape the outbound leg: optional digest `username`/`password`, an
 * `proxy` (network target when it differs from `host`), and the `from*`
 * overrides some peers require for their From identity.
 */
export interface SipPeer {
  /** Domain/IP matched against the Request-URI host (the allowlist key). */
  host: string;
  /** Outbound port (default: the peer's SIP default, 5060). */
  port?: number;
  /** Outbound transport. */
  transport?: 'udp' | 'tcp' | 'tls';
  /** Digest auth username (when the peer challenges). */
  username?: string;
  /** Digest auth password. */
  password?: string;
  /** Outbound proxy (host[:port]) to send to when it differs from `host`. */
  proxy?: string;
  /** Override the From user-part (e.g. a fixed auth user / DID the peer expects). */
  fromUser?: string;
  /** Override the From host-part (default: our own SIP domain). */
  fromHost?: string;
}

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
  sip: {
    // Per-source-IP cap on REGISTER/INVITE within `rateWindowMs` (SIP-level
    // flood/scan defense, applied in SipServer.checkSipRate). Tunable per deploy.
    rateLimit: number;
    rateWindowMs: number;
    // Abuse guard (SipAbuseGuard): ban a source IP after `banThreshold` offenses
    // (flood, unknown-user REGISTER, unroutable/spoofed INVITE) within
    // `banWindowMs`, for `banDurationMs`. `firewallCmd` optionally pushes the ban
    // to the OS firewall ({ip} placeholder). `trustedIps` are never banned.
    banThreshold: number;
    banWindowMs: number;
    banDurationMs: number;
    firewallCmd: string;
    trustedIps: string[];
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
    // Source IPs/CIDRs (besides `host`) trusted as inbound PSTN trunk, e.g. a
    // provider's SIP signaling edges (Twilio Elastic SIP Trunk). Empty = none.
    inboundIps: string[];
  };
  // Approved external SIP peers a registered user may dial (SIP-to-SIP). Empty
  // (no SIP_PEERS) = feature dormant: no external SIP dialing is possible.
  sipPeers: SipPeer[];
  ivr: {
    enabled: boolean;
    entryExtension: string;
    businessHoursStart: number;
    businessHoursEnd: number;
    maxVoicemailSec: number;
    recordingsDir: string;
    defaultLanguage: 'en' | 'hi';
  };
  tts: {
    // Default server-side TTS engine + voice for `say:` prompts (IVR menus,
    // conference, voicemail greetings). Defaults to Piper neural TTS
    // (mod_tts_commandline / en_US-amy-medium, baked into the enjoys-freeswitch
    // image). Per-call callers may override via prepareVoice({ engine, voice }).
    // Set TTS_ENGINE=flite + TTS_VOICE=slt for the bundled flite voices on a
    // stock FreeSWITCH without Piper.
    engine: string;
    voice: string;
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
  widget: {
    // Embeddable click-to-call widget (developer API). When false, the
    // /api/n/widget/* endpoints return 503 and no capability tokens are minted.
    enabled: boolean;
    // Public URL the widget's SIP.js client connects to (drachtio SIP-over-WS).
    // Prefer the explicit PUBLIC_SIP_WS_URL (e.g. wss:// behind a TLS proxy in
    // prod); otherwise fall back to the local ws://<publicIp>:<sipWsPort>, the
    // SAME default the dialer's signaling server uses.
    sipWsUrl: string;
    // ICE servers handed to the widget for WebRTC (PUBLIC_ICE_SERVERS as a JSON
    // array). Defaults to a public STUN server when unset.
    iceServers: Array<{ urls: string | string[]; username?: string; credential?: string }>;
    // TURN REST-API shared secret (must equal coturn's `static-auth-secret`).
    // When set, the API hands the browser SHORT-LIVED HMAC TURN credentials
    // instead of the static username/credential from PUBLIC_ICE_SERVERS, so the
    // long-term secret never reaches the client. Empty = keep static creds.
    turnSecret: string;
    // Lifetime (seconds) of a minted TURN credential. Must comfortably exceed
    // the longest expected call so a relay allocation isn't dropped mid-call.
    turnTtlSec: number;
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
  dialplan: {
    // Emergency numbers for this deployment's region (configurable per-region).
    // A call to any of these is classified RouteType.Emergency and sent straight
    // to the trunk by EmergencyHandler, bypassing internal/IVR matching.
    emergencyNumbers: string[];
  };
  conference: {
    // Multi-party conference rooms (FreeSWITCH mod_conference). A browser joins a
    // room by calling `conf-<roomId>`; the SIP server anchors the leg on the media
    // server and joins it to the named conference so all members are mixed.
    enabled: boolean;
    // FreeSWITCH conference profile (conference.conf.xml). `default` is 8kHz mono.
    profile: string;
    // Hard cap on members per room (-1 = unlimited).
    maxMembers: number;
  };
  queue: {
    // Call queues / ACD (Automatic Call Distribution). A caller dials
    // `queue-<id>`; the SIP server answers them onto the media server, plays
    // hold music, and rings the queue's registered agents one at a time until
    // one answers (then bridges the two legs). All mixing/bridging is done on
    // FreeSWITCH; this layer drives the distribution and keeps the live roster.
    enabled: boolean;
    // Hold music played to waiting callers (a FreeSWITCH stream/file URI).
    moh: string;
    // How long to ring a single agent before moving on to the next (seconds).
    ringTimeoutSecs: number;
    // Max time a caller waits in the queue before giving up (seconds).
    maxWaitSecs: number;
    // Queue definitions, parsed from the QUEUES env var. Each entry maps a queue
    // id to a display name and its roster of agent extensions.
    definitions: Array<{ id: string; name: string; agents: string[]; strategy: string }>;
  };
  teams: {
    // Microsoft Teams "Audio Conferencing" dial-in join. A registered user is
    // bridged onto a Teams meeting by dialing its PSTN dial-in number via the
    // trunk and auto-entering the Conference ID over DTMF.
    //
    // dtmfDelayMs: how long to wait after the Teams leg answers before sending
    //   the Conference ID, so Teams' greeting/IVR is ready to receive digits.
    // defaultDialIn: optional fallback dial-in number (E.164) when the client
    //   sends only a Conference ID; per-call number always overrides it.
    // joinFailMs: if the Teams/trunk leg drops within this window after the two
    //   legs are bridged, the Conference ID was most likely wrong/expired
    //   (Teams rejects it and hangs up) — we play a spoken "couldn't join"
    //   prompt to the caller instead of dropping them silently.
    dtmfDelayMs: number;
    defaultDialIn: string;
    joinFailMs: number;
  };
  billing: {
    // Prepaid wallet. When enabled, ExternalHandler refuses an outbound call
    // whose estimated minimum charge exceeds the caller's wallet balance, and
    // the end-of-call hook debits the wallet by the rated cost. When disabled,
    // there is no gate and no debit (rating still stamps cost for reporting).
    // MUST agree with the Go API's BILLING_PREPAID_ENABLED / BILLING_CURRENCY.
    prepaidEnabled: boolean;
    currency: string;
    // Anti-toll-fraud: when true AND a rate book is loaded, refuse outbound
    // calls to a destination that has NO configured rate (instead of letting
    // them route free). Skipped when no rates are configured, so a workspace
    // that hasn't set up a rate book still places calls normally.
    blockUnrated: boolean;
  };
  // BYON outbound caller-ID expiry. A provider-verified number is presented for
  // at most verifyTtlDays; past that the SQL gate drops it so the user must
  // re-verify (no provider round-trip). 0 disables expiry. MUST match the Go
  // API's CALLER_ID_VERIFY_TTL_DAYS so both ends agree on the window.
  callerId: {
    verifyTtlDays: number;
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

// We run Valkey (Redis-compatible). The env is VALKEY_ADDR=host:port (no scheme,
// to match the Go API), plus optional VALKEY_PASSWORD / VALKEY_DB. node-redis
// wants a full URL, so build redis://[:password@]host:port[/db] from those.
export function buildValkeyUrl(): string {
  const addr = process.env.VALKEY_ADDR || 'localhost:6379';
  const password = process.env.VALKEY_PASSWORD || '';
  const db = process.env.VALKEY_DB || '';
  const auth = password ? `:${encodeURIComponent(password)}@` : '';
  const path = db ? `/${db}` : '';
  return `redis://${auth}${addr}${path}`;
}

// Parse PUBLIC_ICE_SERVERS (a JSON array of RTCIceServer-like objects) handed to
// the click-to-call widget for WebRTC. Falls back to a single public STUN server
// when unset or malformed, so the widget still has a usable (NAT-friendly) config.
function parseIceServers(
  raw?: string,
): Array<{ urls: string | string[]; username?: string; credential?: string }> {
  const fallback = [{ urls: 'stun:stun.l.google.com:19302' }];
  if (!raw || !raw.trim()) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : fallback;
  } catch {
    return fallback;
  }
}

// Parse the QUEUES env var into call-queue definitions. Each `;`-separated
// entry is `id:Name:ext1,ext2[:strategy]`. Malformed entries (missing id or no
// agents) are skipped so one typo can't break the whole list.
function parseQueueDefinitions(raw: string): Array<{ id: string; name: string; agents: string[]; strategy: string }> {
  const valid = new Set(['longest-idle', 'round-robin', 'sequential']);
  return raw
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const [idPart, namePart, agentsPart, strategyPart] = entry.split(':');
      const id = (idPart || '').trim().toLowerCase();
      const agents = (agentsPart || '')
        .split(',')
        .map((a) => a.trim())
        .filter(Boolean);
      const strategy = (strategyPart || '').trim().toLowerCase();
      return {
        id,
        name: (namePart || '').trim() || id,
        agents,
        strategy: valid.has(strategy) ? strategy : 'longest-idle',
      };
    })
    .filter((q) => q.id && q.agents.length > 0);
}

// Parse the SIP_PEERS env var into the external SIP-peer allowlist. Entries are
// `;`-separated; within an entry, fields are `|`-separated. The FIRST field is
// the bare host (the allowlist key); the rest are `key=value` options:
//   host[|port=5060][|transport=udp|tcp|tls][|user=..][|pass=..][|proxy=h:p]
//   [|fromuser=..][|fromhost=..]
// e.g. SIP_PEERS="partner.example.com|transport=tls|user=callnet|pass=secret;sip.acme.io|port=5070"
// A malformed entry (no host) is skipped so one typo can't break the list.
function parseSipPeers(raw: string): SipPeer[] {
  const peers: SipPeer[] = [];
  for (const entry of raw.split(';')) {
    const parts = entry.split('|').map((p) => p.trim()).filter(Boolean);
    if (parts.length === 0) continue;
    const host = parts[0].toLowerCase();
    // First field must be a bare host, not a key=value option.
    if (!host || host.includes('=')) continue;
    const peer: SipPeer = { host };
    for (const field of parts.slice(1)) {
      const eq = field.indexOf('=');
      if (eq < 0) continue;
      const key = field.slice(0, eq).trim().toLowerCase();
      const value = field.slice(eq + 1).trim();
      if (!value) continue;
      switch (key) {
        case 'port': {
          const n = parseInt(value, 10);
          if (Number.isInteger(n) && n > 0 && n < 65536) peer.port = n;
          break;
        }
        case 'transport':
          if (value === 'udp' || value === 'tcp' || value === 'tls') peer.transport = value;
          break;
        case 'user':
        case 'username':
          peer.username = value;
          break;
        case 'pass':
        case 'password':
          peer.password = value;
          break;
        case 'proxy':
          peer.proxy = value;
          break;
        case 'fromuser':
          peer.fromUser = value;
          break;
        case 'fromhost':
          peer.fromHost = value;
          break;
      }
    }
    peers.push(peer);
  }
  return peers;
}

export const config: AppConfig = {
  server: {
    httpPort: parseInt(process.env.HTTP_PORT || '3001'),
    wsPort: parseInt(process.env.WS_PORT || '3002'),
    publicIp: process.env.PUBLIC_IP || '127.0.0.1',
    // SIP realm/URI domain. SIP_DOMAIN overrides DOMAIN for the SIP layer only
    // (sip:<ext>@<domain> in From/To); falls back to DOMAIN then localhost.
    domain: process.env.SIP_DOMAIN || process.env.DOMAIN || 'localhost',
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
  sip: {
    rateLimit: parseInt(process.env.SIP_RATE_LIMIT || '30'),
    rateWindowMs: parseInt(process.env.SIP_RATE_WINDOW_MS || '60000'),
    banThreshold: parseInt(process.env.SIP_BAN_THRESHOLD || '10'),
    banWindowMs: parseInt(process.env.SIP_BAN_WINDOW_MS || '600000'),
    banDurationMs: parseInt(process.env.SIP_BAN_DURATION_MS || '3600000'),
    firewallCmd: process.env.SIP_FIREWALL_CMD || '',
    trustedIps: (process.env.SIP_TRUSTED_IPS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
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
    // Comma-separated IPs/CIDRs trusted as inbound trunk (e.g. Twilio's SIP
    // signaling edges). Independent of TRUNK_HOST so a provider-only inbound
    // works without a legacy trunk configured.
    inboundIps: (process.env.TRUNK_INBOUND_IPS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  },
  // External SIP peers a registered user may dial (SIP-to-SIP). Empty by default.
  sipPeers: parseSipPeers(process.env.SIP_PEERS || ''),
  ivr: {
    enabled: process.env.IVR_ENABLED !== 'false',
    entryExtension: process.env.IVR_ENTRY || '5000',
    businessHoursStart: parseInt(process.env.BIZ_HOURS_START || '9'),
    businessHoursEnd: parseInt(process.env.BIZ_HOURS_END || '18'),
    maxVoicemailSec: parseInt(process.env.MAX_VOICEMAIL_SEC || '180'),
    recordingsDir: FS_RECORDINGS_DIR,
    defaultLanguage: (process.env.IVR_DEFAULT_LANG || 'en') as 'en' | 'hi',
  },
  tts: {
    engine: process.env.TTS_ENGINE || 'tts_commandline',
    voice: process.env.TTS_VOICE || 'en_US-amy-medium',
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
  widget: {
    enabled: process.env.WIDGET_ENABLED !== 'false',
    // Prefer the explicit PUBLIC_SIP_WS_URL (wss:// behind a TLS proxy in prod).
    // Otherwise fall back to ws://<publicIp>:<sipWsPort> — the SAME local default
    // the dialer's signaling server uses. A `wss://<domain>` guess is wrong
    // locally: there's no TLS SIP-WS listener and no port, so SIP.js gets a 1006.
    sipWsUrl:
      process.env.PUBLIC_SIP_WS_URL ||
      `ws://${process.env.PUBLIC_IP || '127.0.0.1'}:${process.env.SIP_WS_PORT || '5065'}`,
    iceServers: parseIceServers(process.env.PUBLIC_ICE_SERVERS),
    // Set to coturn's `static-auth-secret` to switch on ephemeral TURN creds.
    turnSecret: process.env.TURN_STATIC_AUTH_SECRET || '',
    turnTtlSec: parseInt(process.env.TURN_CRED_TTL || '3600'),
  },
  database: {
    url:
      process.env.DATABASE_URL ||
      'postgres://postgres:postgres@localhost:5432/postgres?sslmode=disable',
  },
  redis: {
    url: buildValkeyUrl(),
  },
  audit: {
    enabled: process.env.AUDIT_LOG === 'true',
    flushIntervalMs: parseInt(process.env.AUDIT_FLUSH_MS || '30000'),
  },
  dialplan: {
    // Comma-separated emergency numbers for the deployment region. Defaults to a
    // common multi-region set; override per-country (e.g. EMERGENCY_NUMBERS=911,112).
    emergencyNumbers: (process.env.EMERGENCY_NUMBERS || '911,112,100,101,102,108')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  },
  conference: {
    enabled: process.env.CONFERENCE_ENABLED !== 'false',
    profile: (process.env.CONFERENCE_PROFILE || 'default').trim(),
    maxMembers: parseInt(process.env.CONFERENCE_MAX_MEMBERS || '16'),
  },
  queue: {
    enabled: process.env.QUEUE_ENABLED !== 'false',
    moh: (process.env.QUEUE_MOH || 'local_stream://moh').trim(),
    ringTimeoutSecs: parseInt(process.env.QUEUE_RING_TIMEOUT_SECS || '20'),
    maxWaitSecs: parseInt(process.env.QUEUE_MAX_WAIT_SECS || '300'),
    // QUEUES format: `id:Name:ext1,ext2[:strategy]` entries separated by `;`.
    //   e.g. QUEUES=sales:Sales:1001,1002:longest-idle;support:Support:1003
    // strategy ∈ longest-idle | round-robin | sequential (default longest-idle).
    definitions: parseQueueDefinitions(process.env.QUEUES || ''),
  },
  teams: {
    dtmfDelayMs: parseInt(process.env.TEAMS_DTMF_DELAY_MS || '4000'),
    defaultDialIn: (process.env.TEAMS_DEFAULT_DIALIN || '').trim(),
    joinFailMs: parseInt(process.env.TEAMS_JOIN_FAIL_MS || '8000'),
  },
  billing: {
    prepaidEnabled: process.env.BILLING_PREPAID_ENABLED === 'true',
    currency: (process.env.BILLING_CURRENCY || 'USD').trim(),
    blockUnrated: process.env.BILLING_BLOCK_UNRATED === 'true',
  },
  callerId: {
    verifyTtlDays: parseInt(process.env.CALLER_ID_VERIFY_TTL_DAYS || '90'),
  },
};
