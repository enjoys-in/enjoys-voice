/**
 * Runtime configuration (NOT build-time).
 *
 * Values are injected at container start into `/runtime-config.js`, which sets
 * `window.__RUNTIME_CONFIG__`. This lets a single Docker image be deployed to
 * any environment without rebuilding — just change env vars and restart.
 *
 * Local dev: the file is empty/absent, so we fall back to localhost defaults.
 */
export interface RuntimeConfig {
  API_BASE?: string;
  GO_API_BASE?: string;
  SIGNAL_URL?: string;
  ICE_SERVERS?: RTCIceServer[] | string;
  BRIDGE_URL?: string;
  BRIDGE_TOKEN?: string;
}

declare global {
  interface Window {
    __RUNTIME_CONFIG__?: RuntimeConfig;
  }
}

function runtimeConfig(): RuntimeConfig {
  if (typeof window !== "undefined" && window.__RUNTIME_CONFIG__) {
    return window.__RUNTIME_CONFIG__;
  }
  return {};
}

/** Base URL for the REST API. Falls back to dev (host:3001) when unset. */
export function getApiBase(): string {
  const base = runtimeConfig().API_BASE;
  if (base) return base;
  if (typeof window !== "undefined") {
    return `${window.location.protocol}//${window.location.hostname}:3001`;
  }
  return "";
}

/**
 * Base URL for the Go CRUD API (data routes ported off the Node server).
 * Falls back to dev (host:3003) when unset — Node holds 3001/3002 in dev.
 */
export function getGoApiBase(): string {
  const base = runtimeConfig().GO_API_BASE;
  if (base) return base;
  if (typeof window !== "undefined") {
    return `${window.location.protocol}//${window.location.hostname}:3003`;
  }
  return "";
}

/**
 * Signaling WebSocket URL (presence, call events, in-call recording relay).
 * This is the Node signaling server, which is SEPARATE from the SIP media WS.
 *
 * Prod: set SIGNAL_URL to `wss://DOMAIN/signal` — Caddy upgrades and proxies it
 * to the Node signaling server (api:3002). Dev: falls back to
 * ws(s)://host:3002/signal — the signaling server binds the `/signal` path, so
 * the path is required in BOTH environments (the REST API is on :3001).
 */
export function getSignalingUrl(): string {
  const base = runtimeConfig().SIGNAL_URL;
  if (base) return withSignalPath(base);
  if (typeof window !== "undefined") {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${window.location.hostname}:3002/signal`;
  }
  return "";
}

/**
 * The signaling server only accepts WebSocket upgrades on the `/signal` path
 * (see src/websocket/signaling.server.ts → `path: '/signal'`). A configured
 * SIGNAL_URL / PUBLIC_WS_URL that omits it (e.g. "ws://localhost:3002") would
 * connect to "/" and get rejected by the handshake, so default the path to
 * `/signal` whenever none was supplied. An explicit non-root path is trusted
 * as-is (e.g. a custom Caddy mount).
 */
function withSignalPath(url: string): string {
  try {
    const u = new URL(url);
    if (u.pathname === "" || u.pathname === "/") u.pathname = "/signal";
    return u.toString();
  } catch {
    // Not a parseable absolute URL — best-effort: append /signal unless present.
    return /\/signal\/?$/.test(url) ? url : `${url.replace(/\/+$/, "")}/signal`;
  }
}

/**
 * WebRTC ICE servers. Empty locally (instant ICE gathering, no dial delay);
 * in production set STUN + your TURN server via the `PUBLIC_ICE_SERVERS` env.
 */
export function getIceServers(): RTCIceServer[] {
  const v = runtimeConfig().ICE_SERVERS;
  if (!v) return [];
  if (Array.isArray(v)) return v;
  try {
    const parsed = JSON.parse(v);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    console.warn("Invalid ICE_SERVERS runtime config, using none");
    return [];
  }
}

/**
 * Browser-bridge media WebSocket URL (PSTN caller audio <-> this browser).
 * This is the streaming module's bridge server, SEPARATE from both the signaling
 * WS and the SIP media WS. The page connects with `?id=<extension>` to pair with
 * a call forwarded to it, plus an optional `&token=` when the deployment sets
 * `MEDIA_STREAM_AUTH_TOKEN` (mirrored here as BRIDGE_TOKEN).
 *
 * Prod: set BRIDGE_URL to `wss://DOMAIN/bridge` (Caddy upgrades + proxies it to
 * the bridge server, default :3005). Dev: falls back to ws(s)://host:3005.
 *
 * @param id    pairing id (the user's extension)
 * @returns the full ws(s):// URL with id (+ token) query, or "" when no window.
 */
export function getBridgeUrl(id: string): string {
  const cfg = runtimeConfig();
  let base = cfg.BRIDGE_URL;
  if (!base) {
    if (typeof window === "undefined") return "";
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    base = `${proto}//${window.location.hostname}:3005`;
  }
  base = base.replace(/\/+$/, "");
  const params = new URLSearchParams({ id });
  if (cfg.BRIDGE_TOKEN) params.set("token", cfg.BRIDGE_TOKEN);
  return `${base}/?${params.toString()}`;
}
