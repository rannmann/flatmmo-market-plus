/**
 * Exact order accounting, keyed by the uuid the game assigns each listing.
 *
 * The history feed cannot be made accurate: it re-reports an open order as its
 * sold-count grows, carries only a date, and has no order id, so repeated fills
 * are indistinguishable from separate sales. Worse, no interpretation of it
 * reconciles -- collapsing every duplicate still leaves a total well above the
 * game's own Sales figure.
 *
 * REFRESH_MARKET_UI_POSTINGS has none of those problems. Each listing carries a
 * uuid, an exact `amountSold`, a full ISO `createdAt`, and a direction. Tracking
 * those by uuid gives unambiguous totals and -- unlike the history feed --
 * includes purchases, which is what makes profit and loss possible at all.
 *
 * The catch is coverage: an order is only visible while listed, which lasts
 * until its proceeds are collected. Anything that filled and was collected while
 * the plugin was not watching is never seen. So this is authoritative for what
 * it has observed, and claims nothing about anything earlier.
 */

import { estimateSellTax } from './money.js';

const STORAGE_KEY = 'fmp-market-plus:orders';
const CACHE_VERSION = 1;

export function createOrderTracker({
  storage = safeLocalStorage(),
  now = () => new Date().toISOString(),
  log = () => {},
} = {}) {
  // Null-prototype object rather than a Map: the game shadows the global Map
  // binding with its own world-map class. See the note in flatstats.js.
  let orders = Object.create(null);
  let trackedSince = null;

  function load() {
    if (!storage) return;
    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed.version !== CACHE_VERSION) return;
      trackedSince = parsed.trackedSince || null;
      for (const o of parsed.orders || []) if (o && o.uuid) orders[o.uuid] = o;
    } catch (err) {
      log('order store unreadable, starting fresh:', err && err.message);
    }
  }

  function persist() {
    if (!storage) return;
    try {
      storage.setItem(
        STORAGE_KEY,
        JSON.stringify({ version: CACHE_VERSION, trackedSince, orders: Object.values(orders) })
      );
    } catch (err) {
      log('could not persist orders:', err && err.message);
    }
  }

  load();

  return {
    /**
     * Merge a batch of listings. Returns how many orders changed.
     *
     * `amountSold` only ever grows, so a smaller figure is a stale snapshot and
     * is ignored rather than allowed to walk a total backwards.
     */
    observe(batch) {
      if (!Array.isArray(batch)) return 0;
      if (trackedSince === null) {
        // Marks the boundary between exact tracking and the approximate
        // history-feed backfill, so the two are never silently blended.
        trackedSince = now();
        persist();
      }
      let changed = 0;
      for (const o of batch) {
        if (!o || !o.uuid) continue;
        const sold = Number.isFinite(o.amountSold) ? o.amountSold : 0;
        const existing = orders[o.uuid];
        if (!existing || sold > existing.amountSold) {
          orders[o.uuid] = {
            uuid: o.uuid,
            itemName: o.itemName,
            price: o.price,
            amount: o.amount,
            amountSold: sold,
            direction: o.direction,
            createdAt: o.createdAt,
            lastSeen: now(),
          };
          changed++;
        }
      }
      if (changed > 0) persist();
      return changed;
    },

    /** When exact tracking began; null until the first observation. */
    since() {
      return trackedSince;
    },

    ordersFor(itemName) {
      return Object.values(orders)
        .filter((o) => o.itemName === itemName && o.amountSold > 0)
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    },

    summaryFor(itemName) {
      return summariseOrders(this.ordersFor(itemName));
    },

    size() {
      return Object.keys(orders).length;
    },

    clear() {
      orders = Object.create(null);
      trackedSince = null;
      persist();
    },
  };
}

/**
 * Aggregate tracked orders for one item.
 *
 * Listings carry no tax field, so sell-side tax is this plugin's own estimate
 * from the verified rule (1% at a unit price of 100 or more). That estimate is
 * an upper bound, so net proceeds are never overstated.
 */
export function summariseOrders(list) {
  let soldUnits = 0;
  let soldGross = 0;
  let soldTax = 0;
  let boughtUnits = 0;
  let boughtSpend = 0;

  for (const o of list) {
    if (o.direction === 'sell') {
      soldUnits += o.amountSold;
      soldGross += o.amountSold * o.price;
      soldTax += estimateSellTax(o.price, o.amountSold);
    } else if (o.direction === 'buy') {
      boughtUnits += o.amountSold;
      boughtSpend += o.amountSold * o.price;
    }
  }

  const avgSalePrice = soldUnits > 0 ? soldGross / soldUnits : null;
  const avgCostBasis = boughtUnits > 0 ? boughtSpend / boughtUnits : null;
  const costBasisKnown = boughtUnits > 0;
  const matchedUnits = costBasisKnown ? Math.min(soldUnits, boughtUnits) : 0;

  return {
    orders: list.length,
    soldUnits,
    soldGross,
    soldTax,
    soldNet: soldGross - soldTax,
    avgSalePrice,
    boughtUnits,
    boughtSpend,
    avgCostBasis,
    costBasisKnown,
    matchedUnits,
    realised:
      costBasisKnown && matchedUnits > 0
        ? matchedUnits * (avgSalePrice - avgCostBasis) -
          (soldTax * matchedUnits) / (soldUnits || 1)
        : null,
  };
}

function safeLocalStorage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}
