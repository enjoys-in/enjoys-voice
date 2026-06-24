import crypto from 'crypto';
import { config } from './config';

/** A single ICE server entry as sent to a browser's RTCPeerConnection. */
export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

/**
 * Mint a coturn REST-API (time-limited) TURN credential.
 *
 * coturn's `use-auth-secret` mode expects:
 *   username   = "<unix-expiry-timestamp>"  (optionally "<expiry>:<id>")
 *   credential = base64( HMAC-SHA1( secret, username ) )
 *
 * coturn recomputes the same HMAC with its `static-auth-secret` to authenticate
 * the client, and rejects the request once `now > expiry`. The long-term secret
 * therefore NEVER leaves the server — a captured credential is useless after
 * `ttlSec` seconds, which is the whole point of ephemeral credentials.
 *
 * @param secret  must equal coturn's `static-auth-secret`
 * @param ttlSec  credential lifetime; should exceed the longest expected call
 */
export function mintTurnCredential(
  secret: string,
  ttlSec: number,
): { username: string; credential: string } {
  const expiry = Math.floor(Date.now() / 1000) + Math.max(1, ttlSec);
  const username = String(expiry);
  const credential = crypto
    .createHmac('sha1', secret)
    .update(username)
    .digest('base64');
  return { username, credential };
}

/**
 * ICE servers to hand a browser client.
 *
 * When `TURN_STATIC_AUTH_SECRET` is set (i.e. coturn is running in
 * `use-auth-secret` mode), every `turn:`/`turns:` entry is rewritten with a
 * freshly-minted SHORT-LIVED HMAC credential so the long-term secret is never
 * exposed to the browser. STUN entries pass through untouched.
 *
 * When the secret is empty (default), the static credentials parsed from
 * `PUBLIC_ICE_SERVERS` are returned unchanged — fully backwards compatible.
 */
export function buildIceServers(): IceServer[] {
  const secret = config.widget.turnSecret;
  const servers = config.widget.iceServers as IceServer[];
  if (!secret) return servers;
  const cred = mintTurnCredential(secret, config.widget.turnTtlSec);
  return servers.map((s) =>
    isTurnEntry(s.urls)
      ? { urls: s.urls, username: cred.username, credential: cred.credential }
      : s,
  );
}

/** True when any of the entry's URLs is a TURN (relay) URL. */
function isTurnEntry(urls: string | string[]): boolean {
  const list = Array.isArray(urls) ? urls : [urls];
  return list.some((u) => /^turns?:/i.test(u));
}
