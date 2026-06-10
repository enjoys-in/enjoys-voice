const CACHE_NAME = "sounds-v1";

/**
 * Get a sound URL from Cache Storage, falling back to network.
 * Caches the response for future use.
 */
export async function getCachedSoundUrl(path: string): Promise<string> {
  if (typeof window === "undefined" || !("caches" in window)) return path;

  try {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(path);
    if (cached) {
      const blob = await cached.blob();
      return URL.createObjectURL(blob);
    }

    // Fetch and cache
    const response = await fetch(path);
    if (response.ok) {
      await cache.put(path, response.clone());
      const blob = await response.blob();
      return URL.createObjectURL(blob);
    }
  } catch {
    // Fallback to direct path on any error
  }
  return path;
}

/**
 * Invalidate all cached sounds. Call after upload/delete.
 */
export async function invalidateSoundCache(): Promise<void> {
  if (typeof window === "undefined" || !("caches" in window)) return;
  try {
    await caches.delete(CACHE_NAME);
  } catch {
    // silent
  }
}

/**
 * Invalidate a specific sound from cache.
 */
export async function invalidateCachedSound(path: string): Promise<void> {
  if (typeof window === "undefined" || !("caches" in window)) return;
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.delete(path);
  } catch {
    // silent
  }
}

/**
 * Play a sound using cache. Returns the Audio element.
 */
export async function playCachedSound(path: string, loop = false, volume = 1): Promise<HTMLAudioElement> {
  const url = await getCachedSoundUrl(path);
  const audio = new Audio(url);
  audio.loop = loop;
  audio.volume = volume;
  await audio.play().catch(() => {});
  return audio;
}
