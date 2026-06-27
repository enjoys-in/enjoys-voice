/**
 * Lightweight GET cache + in-flight dedupe shared by the Go (`go-api.ts`) and
 * Node (`api.ts`) REST clients.
 *
 * Why this exists:
 *  - Tabs fetch on open (`useEffect(() => load(), [])`) and the admin shell
 *    re-loads once the persisted user hydrates (role flips), so the same GET
 *    can fire 2× back-to-back. React Strict Mode double-invokes effects in dev
 *    on top of that. Coalescing concurrent identical GETs into one request and
 *    serving a short-lived cache kills those duplicate calls.
 *  - Any mutation (POST/PUT/PATCH/DELETE) invalidates the cached reads for that
 *    resource so the next GET re-fetches fresh data.
 *
 * Keys are namespaced by caller ("g:" for the Go client, "n:" for the Node
 * client) so the two clients never collide.
 */

type Entry = { ts: number; data: unknown };

const cache = new Map<string, Entry>();
const inFlight = new Map<string, Promise<unknown>>();

/** Default freshness window for cached GET responses. */
const DEFAULT_TTL = 30_000; // 30s

export interface CacheOptions {
  /**
   * Freshness window in ms. `0` means "dedupe only": concurrent identical GETs
   * are coalesced but nothing is ever served stale (each settled request makes
   * the next call re-fetch). Use a positive TTL to also cache the result.
   */
  ttl?: number;
}

/**
 * Run `fetcher` through the shared GET cache keyed by `key`.
 *
 * - If a fresh cached value exists (within `ttl`), it is returned without a
 *   network call.
 * - If an identical request is already in flight, the same promise is returned
 *   instead of starting a second one.
 * - Otherwise `fetcher` runs; on success the value is cached (when `ttl > 0`).
 *   Failures are never cached.
 */
export async function cachedGet<T>(
  key: string,
  fetcher: () => Promise<T>,
  opts: CacheOptions = {}
): Promise<T> {
  const ttl = opts.ttl ?? DEFAULT_TTL;

  if (ttl > 0) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.ts < ttl) return hit.data as T;
  }

  const pending = inFlight.get(key);
  if (pending) return pending as Promise<T>;

  const p = fetcher()
    .then((data) => {
      if (ttl > 0) cache.set(key, { ts: Date.now(), data });
      return data;
    })
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, p);
  return p as Promise<T>;
}

/**
 * Drop cached GET responses.
 *
 * - No argument → wipe everything (use when the signed-in user changes).
 * - With a key prefix → drop just that resource family, e.g.
 *   `invalidateCache("g:/webhooks")` after creating/editing/deleting a webhook.
 *
 * In-flight requests are intentionally left alone; only stored results are
 * cleared so the next read re-fetches.
 */
export function invalidateCache(prefix?: string): void {
  if (!prefix) {
    cache.clear();
    return;
  }
  for (const k of cache.keys()) {
    if (k === prefix || k.startsWith(prefix)) cache.delete(k);
  }
}
