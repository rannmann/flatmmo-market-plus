/**
 * Client for the flatstats market API.
 *
 * flatstats already crawls the market and stores order books, hourly book
 * samples and trade history, so this plugin reads from it rather than hitting
 * market.flatmmo.com directly -- one source, already rate-limited, already
 * aggregated.
 *
 * The server reflects the requesting origin with CORS, so a plain fetch from
 * flatmmo.com works and the userscript can stay on `@grant none`. That matters:
 * any @grant value puts the script in Tampermonkey's sandbox, where the game
 * globals FlatMMO+ depends on are only reachable through unsafeWindow.
 */

export const DEFAULT_BASE_URL = 'https://flatstats.ravenwoodsoftware.org';
const DEFAULT_TTL_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 8_000;

export function createFlatstatsClient({
  baseUrl = DEFAULT_BASE_URL,
  ttlMs = DEFAULT_TTL_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = globalThis.fetch?.bind(globalThis),
  now = () => Date.now(),
} = {}) {
  // Plain null-prototype objects, NOT Map/Set. FlatMMO's maps.js declares a
  // top-level `class Map`, and a class declaration binds in the global lexical
  // environment -- which shadows the built-in for every script that runs after
  // it, even though window.Map still points at the native constructor. A bare
  // `new Map()` here silently produces a game world-map object with no .get().
  const cache = Object.create(null);
  const inFlight = Object.create(null);
  const root = String(baseUrl).replace(/\/+$/, '');

  async function request(path) {
    const cached = cache[path];
    if (cached && cached.expires > now()) return cached.value;

    // Collapse concurrent requests for the same path. Selecting an item can
    // fire several UI updates at once and they should share one round trip.
    const pending = inFlight[path];
    if (pending) return pending;

    const promise = (async () => {
      if (typeof fetchImpl !== 'function') throw new Error('no fetch implementation available');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetchImpl(`${root}${path}`, {
          signal: controller.signal,
          credentials: 'omit',
        });
        if (!res.ok) throw new Error(`flatstats ${path} responded ${res.status}`);
        const value = await res.json();
        cache[path] = { value, expires: now() + ttlMs };
        return value;
      } finally {
        clearTimeout(timer);
        delete inFlight[path];
      }
    })();

    inFlight[path] = promise;
    return promise;
  }

  return {
    /** Full detail for one item: book, history, trades, stats. */
    getItem(itemName, range = '7d') {
      if (!isSafeItemName(itemName)) return Promise.reject(new Error('invalid item name'));
      return request(`/api/market/item/${itemName}?range=${encodeURIComponent(range)}`);
    },

    /**
     * Every item definition the tracker knows about: name, display name, icon.
     * The limit is deliberately above the real count (~930) so this stays a
     * single request; the endpoint clamps to whatever actually exists.
     */
    async getItems(limit = 5000) {
      const res = await request(`/api/items?limit=${limit}`);
      return Array.isArray(res?.items) ? res.items : [];
    },

    /** Every item with an active book, plus market-wide summary numbers. */
    getOverview(sort = 'hot') {
      return request(`/api/market/overview?sort=${encodeURIComponent(sort)}`);
    },

    /** Drop cached responses so the next read is fresh. */
    clearCache() {
      for (const key of Object.keys(cache)) delete cache[key];
    },
  };
}

/**
 * Item names are snake_case ASCII. Validating here keeps a malformed name from
 * being pasted into a URL path, and mirrors the server's own guard.
 */
export function isSafeItemName(name) {
  return typeof name === 'string' && /^[a-z0-9_]+$/i.test(name);
}
