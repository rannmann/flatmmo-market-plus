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
  // The current listings, replaced wholesale on every frame. The game rebuilds
  // its postings list from scratch each time, so the frame is the complete set
  // of live orders -- anything missing from it is no longer active.
  let active = [];

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
      active = batch.filter((o) => o && o.uuid);
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

    /** The player's currently live orders. */
    active() {
      return active.slice();
    },

    /**
     * How many units of the player's own still sit at one price level.
     *
     * Used to mark the order book with what is theirs. Only the unsold
     * remainder counts, since a filled portion is no longer resting on the book.
     */
    remainingAt({ itemName, direction, price }) {
      let total = 0;
      for (const o of active) {
        if (o.itemName !== itemName || o.direction !== direction || o.price !== price) continue;
        const remaining = (o.amount || 0) - (o.amountSold || 0);
        if (remaining > 0) total += remaining;
      }
      return total;
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

/**
 * How to label a price level that contains some of the player's own orders.
 *
 * Returns null when none of it is theirs. The book comes from flatstats, which
 * crawls every couple of minutes, while the order list is live -- so the two can
 * disagree briefly. A holding larger than the level is therefore reported as the
 * whole level rather than as an impossible surplus.
 */
export function ownershipLabel(mine, levelQuantity) {
  if (!Number.isFinite(mine) || mine <= 0) return null;
  if (!Number.isFinite(levelQuantity) || mine >= levelQuantity) return 'all yours';
  return `${mine.toLocaleString('en-US')} yours`;
}
