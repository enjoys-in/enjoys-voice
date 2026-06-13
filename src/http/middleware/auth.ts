import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, parseCookies, type JwtClaims } from '@/core';

/** An Express request augmented with the verified JWT claims by `requireAuth`. */
export interface AuthedRequest extends Request {
  auth?: JwtClaims;
}

/**
 * Pull the access token from `Authorization: Bearer <token>`, falling back to
 * the httpOnly `token` cookie set on login (same scheme the Go API and the
 * WebSocket layer use). Returns '' when neither is present or well-formed.
 */
function extractToken(req: Request): string {
  const header = req.headers.authorization;
  if (header) {
    const [scheme, value] = header.split(' ', 2);
    if (value && scheme.toLowerCase() === 'bearer') return value.trim();
  }
  return parseCookies(req.headers.cookie).token || '';
}

/**
 * Authentication gate mirroring the Go API's AuthMiddleware: requires a valid
 * HS256 access token (signed with the shared secret) and attaches the decoded
 * claims to `req.auth`. Rejects with 401 when the token is missing or invalid.
 */
export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const token = extractToken(req);
  if (!token) {
    res.status(401).json({ error: 'Missing authorization token' });
    return;
  }
  const claims = verifyAccessToken(token);
  if (!claims) {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }
  req.auth = claims;
  next();
}

/**
 * Ownership gate for per-user routes: the authenticated extension must match the
 * `:ext` route param, so a user can only reach their own resources (prevents an
 * IDOR where any logged-in user reads another mailbox by changing the URL). Must
 * run after `requireAuth`.
 */
export function requireSelfExtension(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (!req.auth || req.auth.extension !== req.params.ext) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  next();
}
