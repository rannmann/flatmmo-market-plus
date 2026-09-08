/**
 * Display names and icons for every item, so the UI can stop showing
 * "unpowered_orb" to human beings.
 *
 * flatstats serves all ~930 item definitions in one request. That is ~124KB, so
 * it is cached in localStorage and only refetched when the cache expires --
 * item definitions change on game patches, not hourly.
 */

const STORAGE_KEY = 'fmp-market-plus:item-index';
const CACHE_VERSION = 1;
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export function createItemIndex({
  flatstats,
  storage = safeLocalStorage(),
  ttlMs = DEFAULT_TTL_MS,
  now = () => Date.now(),
  log = () => {},
} = {}) {
  // Null-prototype object rather than a Map: see the note in flatstats.js --
  // the game shadows the global Map binding with its own world-map class.
  let byName = Object.create(null);
  let loaded = false;

  function ingest(items) {
    byName = Object.create(null);
    let count = 0;
    for (const item of items) {
      if (!item || !item.name) continue;
      byName[item.name] = {
        name: item.name,
        displayName: item.display_name || prettify(item.name),
        imageUrl: item.image_url || null,
      };
      count++;
    }
    loaded = count > 0;
  }

  function readCache() {
    if (!storage) return null;
    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed.version !== CACHE_VERSION) return null;
      if (!Array.isArray(parsed.items)) return null;
      if (!(parsed.expires > now())) return null;
      return parsed.items;
    } catch {
      return null;
    }
  }

  function writeCache(items) {
    if (!storage) return;
    try {
      storage.setItem(
        STORAGE_KEY,
        JSON.stringify({ version: CACHE_VERSION, expires: now() + ttlMs, items })
      );
    } catch {
      // A full or unavailable localStorage is not worth failing the plugin over;
      // the index simply refetches next session.
    }
  }

  return {
    /**
     * Populate the index. Safe to call repeatedly.
     * A failure here degrades the UI to raw snake_case names rather than
     * breaking it, so the error is logged and swallowed.
     */
    async load() {
      const cached = readCache();
      if (cached) {
        ingest(cached);
        return true;
      }
      try {
        const res = await flatstats.getItems();
        ingest(res);
        writeCache(res);
        return true;
      } catch (err) {
        log('item index unavailable, falling back to raw names:', err && err.message);
        return false;
      }
    },

    isLoaded: () => loaded,

    /** Human-readable name, falling back to a de-underscored raw name. */
    displayName(name) {
      return byName[name]?.displayName || prettify(name);
    },

    iconUrl(name) {
      return (
        byName[name]?.imageUrl ||
        (typeof name === 'string' ? `https://flatmmo.com/images/items/${name}.png` : null)
      );
    },

    /** Every known item, for the typeahead to rank. */
    all() {
      return Object.values(byName);
    },
  };
}

/** "unpowered_orb" -> "Unpowered Orb", for items flatstats has never seen. */
export function prettify(name) {
  if (typeof name !== 'string' || !name) return '';
  return name
    .split('_')
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

function safeLocalStorage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}
