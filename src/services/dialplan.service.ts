import { config } from '@/core';

export type RouteType = 'internal' | 'external' | 'ivr' | 'emergency' | 'blocked';

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
  /** IVR extensions */
  private readonly IVR_PATTERN = /^(5000|18\d{8}|1800\d+|800\d+|888\d+|877\d+|866\d+|855\d+|844\d+|833\d+)$/;
  /** Emergency numbers (configurable) */
  private emergencyNumbers = new Set(['911', '112', '100', '101', '102', '108']);

  resolve(dialed: string): DialResult {
    const cleaned = dialed.replace(/[\s\-()]/g, '');

    // Emergency check first
    if (this.emergencyNumbers.has(cleaned)) {
      return { type: 'emergency', target: cleaned, originalNumber: dialed, normalizedNumber: cleaned };
    }

    // IVR routing
    if (this.IVR_PATTERN.test(cleaned)) {
      return { type: 'ivr', target: cleaned, originalNumber: dialed, normalizedNumber: cleaned };
    }

    // Internal extension (4-7 digits, no country code)
    if (this.INTERNAL_PATTERN.test(cleaned) && !cleaned.startsWith('+')) {
      return { type: 'internal', target: cleaned, originalNumber: dialed, normalizedNumber: cleaned };
    }

    // External (with or without +)
    if (this.EXTERNAL_PATTERN.test(cleaned)) {
      const normalized = this.normalizeExternal(cleaned);
      return { type: 'external', target: normalized, originalNumber: dialed, normalizedNumber: normalized };
    }

    // Default: try as internal extension
    return { type: 'internal', target: cleaned, originalNumber: dialed, normalizedNumber: cleaned };
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
    return this.resolve(number).type === 'internal';
  }

  isExternal(number: string): boolean {
    return this.resolve(number).type === 'external';
  }

  isIvr(number: string): boolean {
    return this.resolve(number).type === 'ivr';
  }
}
