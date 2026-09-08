/**
 * The player's own trading record, accumulated from the game's history feed.
 *
 * The feed is re-sent whole whenever the market panel opens, so entries are
 * deduplicated by identity and merged into a store that only grows. That
 * matters twice over: the server may cap how far back it reports, and purchases
 * are not currently reported at all -- so anything seen once is worth keeping,
 * and any buy records that begin appearing are captured from then on.
 */

import { historyKey } from './protocol.js';

const STORAGE_KEY = 'fmp-market-plus:ledger';
const CACHE_VERSION = 1;

export function createLedger({ storage = safeLocalStorage(), log = () => {} } = {}) {
  // Null-prototype object rather than a Map: the game shadows the global Map
  // binding with its own world-map class. See the note in flatstats.js.
  let entries = Object.create(null);

  function load() {
    if (!storage) return;
    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed.version !== CACHE_VERSION || !Array.isArray(parsed.entries)) return;
      // Apply the same precedence when loading. A store written before orders
      // were keyed without their amount holds one entry per fill snapshot, and
      // those collapse here -- keeping the largest rather than whichever
      // happened to be serialised last.
      for (const e of parsed.entries) {
        const key = historyKey(e);
        if (supersedes(e, entries[key])) entries[key] = e;
      }
    } catch (err) {
      log('ledger unreadable, starting fresh:', err && err.message);
    }
  }

  function persist() {
    if (!storage) return;
    try {
      storage.setItem(
        STORAGE_KEY,
        JSON.stringify({ version: CACHE_VERSION, entries: Object.values(entries) })
      );
    } catch (err) {
      // A full localStorage must not break the market UI; the ledger just keeps
      // what it has in memory for this session.
      log('could not persist ledger:', err && err.message);
    }
  }

  load();

  return {
    /**
     * Merge a batch of parsed history entries. Returns how many changed.
     *
     * Entries recovered from rendered markup carry `provisional: true` because
     * that source has no tax and only a derived unit price. An authoritative
     * frame therefore replaces a provisional entry for the same transaction,
     * while a provisional entry never overwrites real data.
     */
    record(batch) {
      if (!Array.isArray(batch) || batch.length === 0) return 0;
      let changed = 0;
      for (const entry of batch) {
        const key = historyKey(entry);
        const existing = entries[key];
        if (!existing || supersedes(entry, existing)) {
          entries[key] = entry;
          changed++;
        }
      }
      if (changed > 0) persist();
      return changed;
    },

    /** Every recorded transaction for one item, newest first. */
    tradesFor(itemName) {
      return Object.values(entries)
        .filter((e) => e.itemName === itemName)
        .sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)));
    },

    summaryFor(itemName) {
      return summarise(this.tradesFor(itemName));
    },

    size() {
      return Object.keys(entries).length;
    },

    /** Drop everything. */
    clear() {
      entries = Object.create(null);
      persist();
    },
  };
}

/**
 * Does `next` tell us more about this order than `current` does?
 *
 * Real frames beat entries recovered from rendered markup, since those carry no
 * tax. Otherwise the larger amount wins: an order's sold-count only ever grows,
 * so the biggest figure seen is the most complete one.
 */
export function supersedes(next, current) {
  if (!current) return true;
  if (current.provisional && !next.provisional) return true;
  if (!current.provisional && next.provisional) return false;
  return next.amount > current.amount;
}

/**
 * Aggregate a set of transactions for one item.
 *
 * `realised` is only meaningful once purchases exist. While the feed reports
 * sells only, `costBasisKnown` is false and profit is reported as unavailable
 * rather than as revenue -- calling revenue "profit" would overstate it by
 * exactly whatever the goods cost to acquire.
 */
export function summarise(trades) {
  let soldUnits = 0;
  let soldGross = 0;
  let soldTax = 0;
  let boughtUnits = 0;
  let boughtSpend = 0;

  for (const t of trades) {
    if (t.direction === 'sell') {
      soldUnits += t.amount;
      soldGross += t.amount * t.price;
      soldTax += t.tax || 0;
    } else if (t.direction === 'buy') {
      boughtUnits += t.amount;
      boughtSpend += t.amount * t.price;
    }
  }

  const avgSalePrice = soldUnits > 0 ? soldGross / soldUnits : null;
  const avgCostBasis = boughtUnits > 0 ? boughtSpend / boughtUnits : null;
  const costBasisKnown = boughtUnits > 0;

  // Only units actually covered by a purchase can carry a realised profit.
  const matchedUnits = costBasisKnown ? Math.min(soldUnits, boughtUnits) : 0;
  const realised =
    costBasisKnown && matchedUnits > 0
      ? matchedUnits * (avgSalePrice - avgCostBasis) -
        (soldTax * matchedUnits) / (soldUnits || 1)
      : null;

  return {
    trades: trades.length,
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
    realised,
  };
}

function safeLocalStorage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}
