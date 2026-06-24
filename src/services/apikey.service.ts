import crypto from 'crypto';
import { loadApiKeyByPublicKey, type DbApiKey } from './postgres/apikey.repo';

/** A validated, parsed API key ready for use by the widget/originate paths. */
export interface ResolvedApiKey {
  id: number;
  owner: string;
  label: string;
  publicKey: string;
  allowedOrigins: string[];
  allowedIps: string[];
  destination: string;
  callerId: string;
  /** How a widget call is routed: PSTN trunk, internal IVR, or internal extension. */
  routeType: 'trunk' | 'ivr' | 'extension';
  dailyCap: number;
  devMode: boolean;
  active: boolean;
}

/** Why a validation attempt failed (maps to an HTTP status in the route). */
export type ApiKeyDenyReason =
  | 'not_found'
  | 'inactive'
  | 'origin_not_allowed'
  | 'ip_not_allowed'
  | 'daily_cap_reached'
  | 'bad_secret';

export type ApiKeyValidation =
  | { ok: true; key: ResolvedApiKey }
  | { ok: false; reason: ApiKeyDenyReason };

interface CacheEntry {
  key: ResolvedApiKey;
  secretHash: string;
  at: number;
}

/**
 * ApiKeyService validates developer API keys for the embeddable click-to-call
 * widget. It resolves a publishable key from the shared `api_keys` table, then
 * enforces the per-key Origin allow-list, source-IP allow-list (single IPs or
 * CIDR ranges) and a per-UTC-day call cap. The publishable key alone is enough
 * for the browser widget; the secret (sk_…) is verified for server-to-server
 * originate via {@link verifySecret}.
 *
 * Keys are cached briefly (TTL) so a burst of widget loads doesn't hammer
 * Postgres; the cache is short enough that a revoke/edit takes effect quickly.
 */
export class ApiKeyService {
  private cache = new Map<string, CacheEntry>();
  private readonly cacheTtlMs = 30_000;

  // Per-key UTC-day call counters for the daily cap (best-effort, in-memory).
  private dayCounters = new Map<number, { day: string; count: number }>();

  /**
   * Resolve a publishable key and enforce Origin + IP + daily-cap policy.
   * `origin` is the browser Origin header (may be undefined for non-browser
   * callers); `ip` is the real client IP (resolved via trust-proxy upstream).
   */
  async validate(publicKey: string, origin: string | undefined, ip: string): Promise<ApiKeyValidation> {
    const resolved = await this.resolve(publicKey);
    if (!resolved) return { ok: false, reason: 'not_found' };
    const { key } = resolved;

    if (!key.active) return { ok: false, reason: 'inactive' };

    // Per-key dev bypass: when the key has dev mode enabled AND the request
    // comes from localhost/loopback, skip the Origin + IP allow-lists so the
    // widget can be tested locally without whitelisting a dev origin/IP. Only
    // loopback callers are exempted (a remote client never matches), so this is
    // safe even on a key left in dev mode in production; the daily cap below
    // still applies.
    const devBypass = key.devMode && isLocalRequest(origin, ip);
    if (!devBypass) {
      if (!this.originAllowed(key.allowedOrigins, origin)) return { ok: false, reason: 'origin_not_allowed' };
      if (!this.ipAllowed(key.allowedIps, ip)) return { ok: false, reason: 'ip_not_allowed' };
    }
    if (this.capReached(key)) return { ok: false, reason: 'daily_cap_reached' };

    return { ok: true, key };
  }

  /**
   * Verify a server-to-server secret (sk_…) against the stored hash for a given
   * publishable key. Uses a constant-time comparison of the SHA-256 digests
   * (the secret is a high-entropy token, so a fast hash is appropriate).
   */
  async verifySecret(publicKey: string, secret: string): Promise<ApiKeyValidation> {
    const resolved = await this.resolve(publicKey);
    if (!resolved) return { ok: false, reason: 'not_found' };
    if (!resolved.key.active) return { ok: false, reason: 'inactive' };

    const provided = crypto.createHash('sha256').update(secret).digest();
    let stored: Buffer;
    try {
      stored = Buffer.from(resolved.secretHash, 'hex');
    } catch {
      return { ok: false, reason: 'bad_secret' };
    }
    if (stored.length !== provided.length || !crypto.timingSafeEqual(stored, provided)) {
      return { ok: false, reason: 'bad_secret' };
    }
    return { ok: true, key: resolved.key };
  }

  /** Record that a call was placed with this key (advances the daily counter). */
  noteCall(keyId: number, cap: number): void {
    if (cap <= 0) return;
    const today = this.utcDay();
    const entry = this.dayCounters.get(keyId);
    if (!entry || entry.day !== today) {
      this.dayCounters.set(keyId, { day: today, count: 1 });
    } else {
      entry.count += 1;
    }
  }

  /** Invalidate the cache entry for a key (e.g. after a known revoke). */
  invalidate(publicKey: string): void {
    this.cache.delete(publicKey);
  }

  // ─── internals ──────────────────────────────────────────────────────

  private async resolve(publicKey: string): Promise<CacheEntry | null> {
    const cached = this.cache.get(publicKey);
    if (cached && Date.now() - cached.at < this.cacheTtlMs) return cached;

    const row = await loadApiKeyByPublicKey(publicKey);
    if (!row) {
      this.cache.delete(publicKey);
      return null;
    }
    const entry: CacheEntry = { key: parseRow(row), secretHash: row.secret_hash, at: Date.now() };
    this.cache.set(publicKey, entry);
    return entry;
  }

  private originAllowed(allowed: string[], origin?: string): boolean {
    // No allow-list configured → no browser origin is permitted (fail closed).
    if (allowed.length === 0) return false;
    if (!origin) return false;
    const norm = normalizeOrigin(origin);
    return allowed.some((a) => normalizeOrigin(a) === norm);
  }

  private ipAllowed(allowed: string[], ip: string): boolean {
    // Empty allow-list → any IP is permitted (origin is still enforced).
    if (allowed.length === 0) return true;
    if (!ip) return false;
    return allowed.some((entry) => ipMatches(entry, ip));
  }

  private capReached(key: ResolvedApiKey): boolean {
    if (key.dailyCap <= 0) return false;
    const entry = this.dayCounters.get(key.id);
    if (!entry || entry.day !== this.utcDay()) return false;
    return entry.count >= key.dailyCap;
  }

  private utcDay(): string {
    return new Date().toISOString().slice(0, 10);
  }
}

// ─── helpers ──────────────────────────────────────────────────────────

function splitCsv(raw: string): string[] {
  return (raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseRow(row: DbApiKey): ResolvedApiKey {
  return {
    id: row.id,
    owner: row.owner_extension,
    label: row.label,
    publicKey: row.public_key,
    allowedOrigins: splitCsv(row.allowed_origins),
    allowedIps: splitCsv(row.allowed_ips),
    destination: row.destination_number,
    callerId: row.caller_id || '',
    routeType:
      row.route_type === 'ivr' || row.route_type === 'extension' ? row.route_type : 'trunk',
    dailyCap: row.daily_cap || 0,
    devMode: !!row.dev_mode,
    active: !!row.active,
  };
}

/** Lowercase scheme+host(+port), strip a trailing slash and path. */
function normalizeOrigin(origin: string): string {
  const trimmed = origin.trim().replace(/\/+$/, '');
  try {
    const u = new URL(trimmed);
    return `${u.protocol}//${u.host}`.toLowerCase();
  } catch {
    return trimmed.toLowerCase();
  }
}

/**
 * Whether a request originates from the local machine — either a loopback
 * client IP (127.0.0.1 / ::1, incl. IPv4-mapped) or a localhost browser Origin
 * (http://localhost:* / http://127.0.0.1:* / [::1]). Used only to gate the
 * dev-mode bypass, so it must stay strict: anything non-loopback returns false.
 */
function isLocalRequest(origin: string | undefined, ip: string): boolean {
  const cleanIp = stripV4Mapped((ip || '').trim());
  const loopbackIp = cleanIp === '127.0.0.1' || cleanIp === '::1' || cleanIp.startsWith('127.');
  if (loopbackIp) return true;

  if (!origin) return false;
  try {
    const host = new URL(origin).hostname.toLowerCase().replace(/^\[|\]$/g, '');
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
}

/**
 * Whether `ip` matches an allow-list `entry`, which may be a single IP or an
 * IPv4 CIDR (e.g. "198.51.100.0/24"). IPv6 and exact-string matches are also
 * handled; anything unparseable only matches by exact string.
 */
function ipMatches(entry: string, ip: string): boolean {
  const target = stripV4Mapped(ip);
  if (entry === ip || entry === target) return true;

  const slash = entry.indexOf('/');
  if (slash === -1) return false; // plain IP, already compared above

  const range = entry.slice(0, slash);
  const bits = parseInt(entry.slice(slash + 1), 10);
  if (!Number.isFinite(bits)) return false;

  const a = ipv4ToInt(range);
  const b = ipv4ToInt(target);
  if (a === null || b === null) return false; // non-IPv4 CIDR not supported
  if (bits <= 0) return true;
  if (bits > 32) return false;
  const mask = bits === 32 ? 0xffffffff : (~((1 << (32 - bits)) - 1)) >>> 0;
  return (a & mask) === (b & mask);
}

/** Normalize an IPv4-mapped IPv6 address (::ffff:1.2.3.4) to plain IPv4. */
function stripV4Mapped(ip: string): string {
  const m = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  return m ? m[1] : ip;
}

/** Parse a dotted IPv4 string to a 32-bit unsigned int, or null if invalid. */
function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    value = (value << 8) | n;
  }
  return value >>> 0;
}
