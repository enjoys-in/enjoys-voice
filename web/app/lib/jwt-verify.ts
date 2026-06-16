import { jwtVerify, decodeJwt, type JWTPayload } from "jose";

/** The minimal session the server derives from the access-token JWT. */
export interface ServerSession {
  extension: string;
  userId?: number;
}

function secretKey(): Uint8Array | null {
  const s = process.env.JWT_SECRET;
  return s ? new TextEncoder().encode(s) : null;
}

function toSession(payload: JWTPayload): ServerSession | null {
  // Only access tokens establish a session (refresh tokens carry type:"refresh").
  if (typeof payload.type === "string" && payload.type !== "access") return null;
  const extension =
    typeof payload.extension === "string"
      ? payload.extension
      : typeof payload.sub === "string"
        ? payload.sub
        : "";
  if (!extension) return null;
  const userId = typeof payload.user_id === "number" ? payload.user_id : undefined;
  return { extension, userId };
}

/**
 * Verify the access-token JWT (HS256) and return the minimal session, or null.
 *
 * Pure (jose only, no `next/headers`) so it can be imported from BOTH the edge
 * middleware and server components. When JWT_SECRET is available to the web
 * server it fully verifies the signature + expiry; without it (e.g. local dev
 * where only the Go/Node services hold the secret) it falls back to an
 * unverified decode that still checks expiry. That fallback is safe because the
 * API independently verifies every request — an unverifiable cookie only affects
 * which client chrome renders, never data access.
 */
export async function verifyAuthToken(
  token: string | undefined | null
): Promise<ServerSession | null> {
  if (!token) return null;

  const key = secretKey();
  if (key) {
    try {
      const { payload } = await jwtVerify(token, key);
      return toSession(payload);
    } catch {
      // Bad signature or expired → not authenticated.
      return null;
    }
  }

  // Dev fallback: no secret on the web server → decode without verifying.
  try {
    const payload = decodeJwt(token);
    const expMs = typeof payload.exp === "number" ? payload.exp * 1000 : 0;
    if (expMs && expMs <= Date.now()) return null;
    return toSession(payload);
  } catch {
    return null;
  }
}
