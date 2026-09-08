import { describe, it, expect, vi, afterEach } from 'vitest';
import { createFlatstatsClient, isSafeItemName } from '../src/flatstats.js';
import { createItemIndex } from '../src/itemIndex.js';

const okFetch = (payload) =>
  vi.fn(async () => ({ ok: true, status: 200, json: async () => payload }));

afterEach(() => {
  delete globalThis.Map;
});

/**
 * FlatMMO's maps.js declares a top-level `class Map`, which shadows the built-in
 * for every script running after it on play.php. These tests stand in a hostile
 * Map so anything reaching for the global binding blows up the way it did in the
 * real client ("cache.get is not a function").
 */
function shadowGlobalMap() {
  class GameMap {
    constructor() {
      this.image = null;
      this.tiles = [];
    }
  }
  globalThis.Map = GameMap;
}

describe('createFlatstatsClient', () => {
  it('fetches and returns item detail', async () => {
    const fetchImpl = okFetch({ item_name: 'stardust', best_buy: 6 });
    const client = createFlatstatsClient({ fetchImpl });
    await expect(client.getItem('stardust')).resolves.toMatchObject({ best_buy: 6 });
  });

  it('works when the page has shadowed the global Map', async () => {
    shadowGlobalMap();
    const fetchImpl = okFetch({ item_name: 'stardust' });
    const client = createFlatstatsClient({ fetchImpl });
    await expect(client.getItem('stardust')).resolves.toMatchObject({ item_name: 'stardust' });
  });

  it('serves a repeat request from cache', async () => {
    const fetchImpl = okFetch({ ok: 1 });
    const client = createFlatstatsClient({ fetchImpl, ttlMs: 10_000, now: () => 0 });
    await client.getItem('stardust');
    await client.getItem('stardust');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('refetches once the cache entry expires', async () => {
    const fetchImpl = okFetch({ ok: 1 });
    let t = 0;
    const client = createFlatstatsClient({ fetchImpl, ttlMs: 100, now: () => t });
    await client.getItem('stardust');
    t = 500;
    await client.getItem('stardust');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('collapses concurrent requests for the same path', async () => {
    const fetchImpl = okFetch({ ok: 1 });
    const client = createFlatstatsClient({ fetchImpl });
    await Promise.all([client.getItem('stardust'), client.getItem('stardust')]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('clearCache forces a refetch', async () => {
    const fetchImpl = okFetch({ ok: 1 });
    const client = createFlatstatsClient({ fetchImpl, now: () => 0 });
    await client.getItem('stardust');
    client.clearCache();
    await client.getItem('stardust');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('rejects a non-OK response', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    const client = createFlatstatsClient({ fetchImpl });
    await expect(client.getItem('stardust')).rejects.toThrow(/500/);
  });

  it('does not retry a failed request from a poisoned cache', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    const client = createFlatstatsClient({ fetchImpl });
    await expect(client.getItem('stardust')).rejects.toThrow();
    await expect(client.getItem('stardust')).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('refuses an unsafe item name before it reaches a URL', async () => {
    const fetchImpl = okFetch({});
    const client = createFlatstatsClient({ fetchImpl });
    await expect(client.getItem('../../admin')).rejects.toThrow(/invalid item name/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('isSafeItemName', () => {
  it('accepts snake_case names and rejects anything else', () => {
    expect(isSafeItemName('unpowered_orb')).toBe(true);
    expect(isSafeItemName('../etc')).toBe(false);
    expect(isSafeItemName('a b')).toBe(false);
    expect(isSafeItemName(null)).toBe(false);
  });
});

describe('createItemIndex', () => {
  const items = [
    { name: 'unpowered_orb', display_name: 'Unpowered Orb', image_url: 'u.png' },
    { name: 'stardust', display_name: 'Stardust', image_url: 's.png' },
  ];
  const flatstats = { getItems: async () => items };

  it('works when the page has shadowed the global Map', async () => {
    shadowGlobalMap();
    const index = createItemIndex({ flatstats, storage: null });
    await index.load();
    expect(index.isLoaded()).toBe(true);
    expect(index.displayName('unpowered_orb')).toBe('Unpowered Orb');
    expect(index.all()).toHaveLength(2);
  });

  it('falls back to a prettified name for unknown items', async () => {
    const index = createItemIndex({ flatstats, storage: null });
    await index.load();
    expect(index.displayName('mystery_thing')).toBe('Mystery Thing');
  });

  it('degrades quietly when flatstats is unreachable', async () => {
    const index = createItemIndex({
      flatstats: { getItems: async () => { throw new Error('offline'); } },
      storage: null,
    });
    await expect(index.load()).resolves.toBe(false);
    expect(index.isLoaded()).toBe(false);
    expect(index.displayName('unpowered_orb')).toBe('Unpowered Orb');
  });
});
