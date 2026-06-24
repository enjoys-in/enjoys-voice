import jwt from 'jsonwebtoken';
import { config } from './config';

/**
 * A capability token minted by the widget-session endpoint and presented by the
 * browser on its SIP INVITE (in the `X-Widget-Token` header). It authorizes ONE
 * narrow action — placing a call to a single, pre-locked destination — and is
 * short-lived, so even if it leaks it expires quickly and can't be repurposed.
 *
 * It is deliberately distinct from the Go-issued access token: `type` is
 * `'widget'` (access tokens are rejected here and vice-versa), and it carries
 * the locked destination/caller-id the SIP layer enforces.
 */
export interface WidgetTokenClaims {
  type: 'widget';
  /** api_keys.id the token was minted for (for auditing / rate accounting). */
  keyId: number;
  /** Owner extension that owns the API key. */
  owner: string;
  /** The single destination number this token may dial. */
  destination: string;
  /** Caller ID to present to the destination (may be empty → trunk default). */
  callerId: string;
  /** How the SIP layer routes this call: PSTN trunk, internal IVR, or extension. */
  routeType: 'trunk' | 'ivr' | 'extension';
  iss?: string;
  iat?: number;
  exp?: number;
}

/** Default lifetime of a widget capability token (seconds). */
export const WIDGET_TOKEN_TTL_SECONDS = 120;

/**
 * Sign a short-lived widget capability token (HS256, shared JWT secret). The
 * `type: 'widget'` discriminator keeps it from ever being accepted as a session
 * access token.
 */
export function signWidgetToken(
  payload: Omit<WidgetTokenClaims, 'type' | 'iss' | 'iat' | 'exp'>,
  ttlSeconds: number = WIDGET_TOKEN_TTL_SECONDS,
): string {
  return jwt.sign(
    { ...payload, type: 'widget' },
    config.auth.jwtSecret,
    {
      algorithm: 'HS256',
      issuer: config.auth.jwtIssuer || undefined,
      expiresIn: ttlSeconds,
    },
  );
}

/**
 * Verify a widget capability token. Returns the decoded claims when the
 * signature, expiry, issuer and `type: 'widget'` discriminator all check out;
 * otherwise null. Only HS256 is accepted (algorithm-confusion defense).
 */
export function verifyWidgetToken(token: string): WidgetTokenClaims | null {
  if (!token) return null;

  let decoded: jwt.JwtPayload | string;
  try {
    decoded = jwt.verify(token, config.auth.jwtSecret, {
      algorithms: ['HS256'],
      issuer: config.auth.jwtIssuer || undefined,
      clockTolerance: 5,
    });
  } catch {
    return null;
  }
  if (typeof decoded !== 'object' || decoded === null) return null;

  const claims = decoded as WidgetTokenClaims;
  if (claims.type !== 'widget') return null;
  if (!claims.destination) return null;

  return claims;
}
