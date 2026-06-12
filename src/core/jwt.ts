import jwt from 'jsonwebtoken';
import { config } from './config';

/**
 * JWT claims issued by the Go API. Mirrors api/internal/token/token.go:
 * a custom payload ({extension, user_id, type}) plus the standard registered
 * claims (iss, sub, iat, exp). Tokens are signed HS256 with a shared secret.
 */
export interface JwtClaims {
  extension: string;
  user_id: number;
  type: string;
  iss?: string;
  sub?: string;
  iat?: number;
  exp?: number;
}

/**
 * Verify an HS256 access token produced by the Go API using the shared secret.
 * Returns the decoded claims when the signature, expiry, issuer and token type
 * all check out; otherwise null.
 *
 * Verification (signature + expiry) is delegated to `jsonwebtoken`. Only the
 * symmetric HS256 algorithm is accepted — 'none' and asymmetric algs are
 * rejected to avoid algorithm-confusion attacks. The issuer is enforced when
 * configured, and refresh tokens are never accepted for a socket.
 */
export function verifyAccessToken(token: string): JwtClaims | null {
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

  const claims = decoded as JwtClaims;
  // Only access tokens authorize a socket — never refresh tokens.
  if (claims.type !== 'access') return null;
  if (!claims.extension) return null;

  return claims;
}

/**
 * Parse a Cookie request header into a flat map. Returns {} when absent.
 * Values are URL-decoded; malformed pairs are skipped.
 */
export function parseCookies(header?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    if (!key) continue;
    const val = part.slice(idx + 1).trim();
    try {
      out[key] = decodeURIComponent(val);
    } catch {
      out[key] = val;
    }
  }
  return out;
}
