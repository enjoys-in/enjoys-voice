import { config } from '@/core';

export enum RouteType {
  Internal = 'internal',
  External = 'external',
  IVR = 'ivr',
  Emergency = 'emergency',
  Conference = 'conference',
  Queue = 'queue',
  Blocked = 'blocked',
}

export interface DialResult {
  type: RouteType;
  target: string;
  originalNumber: string;
  normalizedNumber: string;
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
