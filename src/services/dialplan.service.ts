import Srf from 'drachtio-srf';
import { config } from '@/core';
import type { SipPeer } from '@/core';

export enum RouteType {
  Internal = 'internal',
  External = 'external',
  IVR = 'ivr',
  Emergency = 'emergency',
  Conference = 'conference',
  Queue = 'queue',
  Blocked = 'blocked',
  /** Outbound SIP-to-SIP call to an approved external peer (config.sipPeers). */
  SipUri = 'sip_uri',
}

export interface DialResult {
  type: RouteType;
  target: string;
  originalNumber: string;
  normalizedNumber: string;
}

/**
 * Find the approved external SIP peer whose host matches `host` (the allowlist
 * key). Returns undefined when the host isn't in `config.sipPeers`, so callers
 * fail closed: an un-approved domain is never dialable. Exported so the SIP-URI
 * route handler can resolve the matched peer's connection details.
 */
export function findSipPeer(host: string): SipPeer | undefined {
  if (!host) return undefined;
  const h = host.toLowerCase();
  return config.sipPeers.find((p) => p.host === h);
}

export class DialPlanService {
  /** Internal extension range */
  private readonly INTERNAL_PATTERN = /^\d{4,7}$/;
  /** External with country code */
  private readonly EXTERNAL_PATTERN = /^\+?\d{7,15}$/;
  /**
   * Conference room address. The browser dials `conf-<roomId>`; the dialed
   * string is first stripped of spaces/hyphens/parens, so `conf-abc123` and
   * `confabc123` both arrive here as `confabc123`. The captured group is the
   * room id. The literal `conf` prefix disambiguates a room from an internal
   * extension, so this is checked before the numeric patterns.
   */
  private readonly CONFERENCE_PATTERN = /^conf([a-z0-9]{3,32})$/i;
  /**
   * Call queue / ACD address. The browser dials `queue-<id>`; like the
   * conference pattern the dialed string is first stripped of spaces/hyphens,
   * so `queue-sales` and `queuesales` both arrive as `queuesales`. The captured
   * group is the queue id. The literal `queue` prefix disambiguates it from an
   * internal extension, so this is checked before the numeric patterns.
   */
  private readonly QUEUE_PATTERN = /^queue([a-z0-9]{2,32})$/i;
  /** IVR extensions */
  private readonly IVR_PATTERN = /^(5000|18\d{8}|1800\d+|800\d+|888\d+|877\d+|866\d+|855\d+|844\d+|833\d+)$/;
  /** Emergency numbers — configurable per-region via `EMERGENCY_NUMBERS`. */
  private emergencyNumbers = new Set(config.dialplan.emergencyNumbers);

  resolve(dialed: string): DialResult {
    const cleaned = dialed.replace(/[\s\-()]/g, '');
    // Emergency check first
    if (this.emergencyNumbers.has(cleaned)) {
      return { type: RouteType.Emergency, target: cleaned, originalNumber: dialed, normalizedNumber: cleaned };
    }

    // Conference room (conf-<roomId>) — checked before numeric patterns so a
    // room id made of digits can't be mistaken for an internal extension.
    const confMatch = cleaned.match(this.CONFERENCE_PATTERN);
    if (confMatch) {
      const roomId = confMatch[1].toLowerCase();
      return { type: RouteType.Conference, target: roomId, originalNumber: dialed, normalizedNumber: `conf-${roomId}` };
    }

    // Call queue (queue-<id>) — checked before numeric patterns so a queue id
    // made of digits can't be mistaken for an internal extension.
    const queueMatch = cleaned.match(this.QUEUE_PATTERN);
    if (queueMatch) {
      const queueId = queueMatch[1].toLowerCase();
      return { type: RouteType.Queue, target: queueId, originalNumber: dialed, normalizedNumber: `queue-${queueId}` };
    }

    // IVR routing
    if (this.IVR_PATTERN.test(cleaned)) {
      return { type: RouteType.IVR, target: cleaned, originalNumber: dialed, normalizedNumber: cleaned };
    }

    // Internal extension (4-7 digits, no country code)
    if (this.INTERNAL_PATTERN.test(cleaned) && !cleaned.startsWith('+')) {
      return { type: RouteType.Internal, target: cleaned, originalNumber: dialed, normalizedNumber: cleaned };
    }

    // External (with or without +)
    if (this.EXTERNAL_PATTERN.test(cleaned)) {
      const normalized = this.normalizeExternal(cleaned);
      return { type: RouteType.External, target: normalized, originalNumber: dialed, normalizedNumber: normalized };
    }

    // Default: try as internal extension
    return { type: RouteType.Internal, target: cleaned, originalNumber: dialed, normalizedNumber: cleaned };
  }

  /**
   * Classify an INVITE Request-URI as an EXTERNAL SIP call when its host matches
   * an approved peer in `config.sipPeers`. Returns a SipUri DialResult (target
   * `user@host`), or null when the host is not allowlisted — in which case
   * normal in-domain extension/number routing applies. This is the ONLY
   * producer of a SipUri route, so an un-approved domain can never be dialed.
   *
   * The browser/SIP client reaches this by dialing the full SIP URI
   * (`sip:bob@partner.example.com`); drachtio receives the INVITE with that
   * Request-URI even though we are its outbound proxy, so `parsed.host` is the
   * external peer's domain (not our own).
   */
  resolveExternalSip(uri?: string): DialResult | null {
    if (!uri || config.sipPeers.length === 0) return null;
    let parsed: ReturnType<typeof Srf.parseUri> | undefined;
    try {
      parsed = Srf.parseUri(uri);
    } catch {
      return null;
    }
    const host = (parsed?.host || '').toLowerCase();
    if (!host || !findSipPeer(host)) return null;
    const user = (parsed?.user || '').trim();
    const target = user ? `${user}@${host}` : host;
    return {
      type: RouteType.SipUri,
      target,
      originalNumber: uri,
      normalizedNumber: `sip:${target}`,
    };
  }

  private normalizeExternal(number: string): string {
    let clean = number.replace(/[^+\d]/g, '');
    if (!clean.startsWith('+')) {
      // Assume India if 10 digits starting with 6-9
      if (clean.length === 10 && /^[6-9]/.test(clean)) {
        clean = '+91' + clean;
      } else if (clean.length === 10) {
        clean = '+1' + clean; // US/Canada
      } else {
        clean = '+' + clean;
      }
    }
    return clean;
  }

  isInternal(number: string): boolean {
    return this.resolve(number).type === RouteType.Internal;
  }

  isExternal(number: string): boolean {
    return this.resolve(number).type === RouteType.External;
  }

  isIvr(number: string): boolean {
    return this.resolve(number).type === RouteType.IVR;
  }
}
