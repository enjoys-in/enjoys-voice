const CACHE_NAME = "voicemails-v1";

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

    // First time: fetch and cache for next time.
    const response = await fetch(url);
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
