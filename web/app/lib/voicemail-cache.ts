import { getAccessToken, refreshAccessToken } from "./go-api";

const CACHE_NAME = "voicemails-v1";

/**
 * Fetch a (JWT-protected) voicemail recording with the shared access token,
 * refreshing once on a 401 — same scheme as the Go/Node JSON clients. Kept
 * separate from the JSON request helpers because this returns the raw Response
 * (streamed into Cache Storage / a Blob), not a parsed envelope.
 */
async function fetchVoicemailAudio(url: string, retryOn401 = true): Promise<Response> {
  const token = getAccessToken();
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    // Cookie-based auth: the httpOnly access-token cookie is attached so the
    // protected audio route authorizes even without a JS Bearer token.
    credentials: "include",
  });
  if (res.status === 401 && retryOn401) {
    const newToken = await refreshAccessToken();
    if (newToken) return fetchVoicemailAudio(url, false);
  }
  return res;
}

/**
 * Resolve a voicemail audio URL through Cache Storage, falling back to network.
 *
 * Voicemail recordings are immutable once written by the backend, so the very
 * first playback fetches the file and stores it; every later playback is served
 * straight from the browser cache — no backend round-trip. Returns a `blob:`
 * object URL on a cache hit / successful fetch, or the original URL as a
 * fallback when Cache Storage is unavailable or the fetch fails.
 *
 * Blob URLs returned here must be revoked by the caller once the audio element
 * is done with them (see VoicemailScreen) to avoid leaking memory.
 */
export async function getCachedVoicemailUrl(url: string): Promise<string> {
  if (typeof window === "undefined" || !("caches" in window)) return url;

  try {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(url);
    if (cached) {
      const blob = await cached.blob();
      return URL.createObjectURL(blob);
    }

    // First time: fetch (authenticated) and cache for next time.
    const response = await fetchVoicemailAudio(url);
    if (response.ok) {
      await cache.put(url, response.clone());
      const blob = await response.blob();
      return URL.createObjectURL(blob);
    }
  } catch {
    // Fall back to the direct URL on any error.
  }
  return url;
}

/**
 * Evict a single voicemail recording from the cache. Call after the user
 * deletes it so the freed recording isn't kept around in the browser.
 */
export async function invalidateCachedVoicemail(url: string): Promise<void> {
  if (typeof window === "undefined" || !("caches" in window)) return;
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.delete(url);
  } catch {
    // silent
  }
}

/**
 * Drop the entire voicemail audio cache (e.g. on logout / account switch).
 */
export async function invalidateVoicemailCache(): Promise<void> {
  if (typeof window === "undefined" || !("caches" in window)) return;
  try {
    await caches.delete(CACHE_NAME);
  } catch {
    // silent
  }
}
