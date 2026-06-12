/**
 * WebRTC ICE server configuration.
 *
 * Now sourced from RUNTIME config (`window.__RUNTIME_CONFIG__`) so the same
 * build works in any environment without rebuilding. See `runtime-config.ts`.
 *
 * Production: set `PUBLIC_ICE_SERVERS` env (JSON array) on the web container.
 *   PUBLIC_ICE_SERVERS=[{"urls":"stun:..."},{"urls":"turn:...","username":"u","credential":"p"}]
 */
export { getIceServers } from "./runtime-config";

