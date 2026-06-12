/**
 * WebRTC ICE server configuration.
 *
 * Configurable via the `NEXT_PUBLIC_ICE_SERVERS` env var (JSON array of
 * RTCIceServer objects). When unset, no ICE servers are used — ideal for
 * local/Docker development where all peers are on local IPs, which makes
 * ICE gathering instant (no STUN round-trips → no ~2s dial delay).
 *
 * Production example (.env):
 *   NEXT_PUBLIC_ICE_SERVERS=[{"urls":"stun:stun.l.google.com:19302"},{"urls":"turn:turn.example.com:3478","username":"user","credential":"pass"}]
 */
export function getIceServers(): RTCIceServer[] {
  const raw = process.env.NEXT_PUBLIC_ICE_SERVERS;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    console.warn("Invalid NEXT_PUBLIC_ICE_SERVERS JSON, using no ICE servers");
    return [];
  }
}
