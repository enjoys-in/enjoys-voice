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
 * to the Node signaling server (api:3002). Dev: falls back to ws(s)://host:3002,
 * the signaling server's own port (the REST API is on :3001).
 */
export function getSignalingUrl(): string {
  const base = runtimeConfig().SIGNAL_URL;
  if (base) return base;
  if (typeof window !== "undefined") {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${window.location.hostname}:3002`;
  }
  return "";
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
