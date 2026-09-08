import { describe, it, expect } from 'vitest';
import { parseHistory, historyKey } from '../src/protocol.js';
import { createLedger, summarise, supersedes } from '../src/ledger.js';

/** In-memory stand-in for localStorage. */
function fakeStorage() {
  const map = Object.create(null);
  return {
    getItem: (k) => (k in map ? map[k] : null),
    setItem: (k, v) => {
      map[k] = String(v);
    },
    get raw() {
      return map;
    },
  };
}

const sell = (item, price, amount, tax, at) => [item, String(price), String(amount), String(tax), 'sell', at];
const buy = (item, price, amount, at) => [item, String(price), String(amount), '0', 'buy', at];

describe('parseHistory', () => {
  it('parses a sell transaction', () => {
    expect(parseHistory(sell('stardust', 11, 25, 0, '2026-09-08'))).toEqual([
      { itemName: 'stardust', price: 11, amount: 25, tax: 0, direction: 'sell', completedAt: '2026-09-08' },
    ]);
  });

  it('parses buys too, so purchases are captured if the feed ever sends them', () => {
    const [entry] = parseHistory(buy('stardust', 6, 100, '2026-09-08'));
    expect(entry).toMatchObject({ direction: 'buy', price: 6, amount: 100 });
  });

  it('parses several transactions back to back', () => {
    const values = [...sell('a', 1, 2, 0, 'x'), ...sell('b', 3, 4, 1, 'y')];
    expect(parseHistory(values)).toHaveLength(2);
  });

  it('returns nothing for the "none" sentinel or empty input', () => {
    expect(parseHistory(['none'])).toEqual([]);
    expect(parseHistory([])).toEqual([]);
    expect(parseHistory(null)).toEqual([]);
  });

  it('skips a malformed record rather than emitting NaN', () => {
    const values = [...sell('a', 1, 2, 0, 'x'), 'b', 'notanumber', '4', '0', 'sell', 'y'];
    expect(parseHistory(values)).toHaveLength(1);
  });

  it('skips an unrecognised direction', () => {
    expect(parseHistory(['a', '1', '2', '0', 'sideways', 'x'])).toEqual([]);
  });

  it('drops a trailing partial group', () => {
    expect(parseHistory([...sell('a', 1, 2, 0, 'x'), 'b', '3'])).toHaveLength(1);
  });
});

describe('historyKey', () => {
  it('is stable for the same transaction', () => {
    const [a] = parseHistory(sell('stardust', 11, 25, 0, 'x'));
    const [b] = parseHistory(sell('stardust', 11, 25, 0, 'x'));
    expect(historyKey(a)).toBe(historyKey(b));
  });

  it('is the same for two reports of one order at different fill levels', () => {
    // The feed re-reports an open order as its sold-count grows; those are the
    // same order, not two sales.
    const [a] = parseHistory(sell('stardust', 11, 25, 0, 'x'));
    const [b] = parseHistory(sell('stardust', 11, 26, 0, 'x'));
    expect(historyKey(a)).toBe(historyKey(b));
  });

  it('differs by item, price, direction and timestamp', () => {
    const [base] = parseHistory(sell('stardust', 11, 25, 0, 'x'));
    for (const other of [
      sell('ashes', 11, 25, 0, 'x'),
      sell('stardust', 12, 25, 0, 'x'),
      sell('stardust', 11, 25, 0, 'y'),
      buy('stardust', 11, 25, 'x'),
    ]) {
      const [e] = parseHistory(other);
      expect(historyKey(e)).not.toBe(historyKey(base));
    }
  });
});

describe('supersedes', () => {
  const real = (amount) => ({ amount, provisional: false });
  const prov = (amount) => ({ amount, provisional: true });

  it('accepts anything when there is nothing yet', () => {
    expect(supersedes(real(1), null)).toBe(true);
  });

  it('prefers a real frame over a recovered entry', () => {
    expect(supersedes(real(1), prov(999))).toBe(true);
  });

  it('never lets a recovered entry displace real data', () => {
    expect(supersedes(prov(999), real(1))).toBe(false);
  });

  it('prefers the larger amount, since a sold count only grows', () => {
    expect(supersedes(real(500), real(100))).toBe(true);
    expect(supersedes(real(100), real(500))).toBe(false);
  });
});

describe('an order reported repeatedly as it fills', () => {
  it('counts the sale once, at its final size', () => {
    // Observed live: one listing reported at 25, then 391, then 67,451.
    const ledger = createLedger({ storage: null });
    for (const amount of [25, 391, 67_451]) {
      ledger.record(parseHistory(sell('unpowered_orb', 83, amount, 0, '2026-09-08')));
    }
    const stats = ledger.summaryFor('unpowered_orb');
    expect(ledger.tradesFor('unpowered_orb')).toHaveLength(1);
    expect(stats.soldUnits).toBe(67_451);
    expect(stats.soldGross).toBe(67_451 * 83);
  });

  it('does not shrink if an older snapshot arrives later', () => {
    const ledger = createLedger({ storage: null });
    ledger.record(parseHistory(sell('a', 10, 500, 0, 'd')));
    ledger.record(parseHistory(sell('a', 10, 100, 0, 'd')));
    expect(ledger.summaryFor('a').soldUnits).toBe(500);
  });

  it('still separates orders at different prices on the same day', () => {
    const ledger = createLedger({ storage: null });
    ledger.record(parseHistory([...sell('a', 10, 5, 0, 'd'), ...sell('a', 11, 5, 0, 'd')]));
    expect(ledger.tradesFor('a')).toHaveLength(2);
  });
});

describe('createLedger', () => {
  it('records new entries and reports how many were added', () => {
    const ledger = createLedger({ storage: fakeStorage() });
    expect(ledger.record(parseHistory(sell('stardust', 11, 25, 0, 'x')))).toBe(1);
    expect(ledger.size()).toBe(1);
  });

  it('deduplicates the same feed being re-sent', () => {
    const ledger = createLedger({ storage: fakeStorage() });
    const batch = parseHistory(sell('stardust', 11, 25, 0, 'x'));
    ledger.record(batch);
    expect(ledger.record(batch)).toBe(0);
    expect(ledger.size()).toBe(1);
  });

  it('keeps entries the server later stops reporting', () => {
    // The feed may be capped; anything seen once must survive.
    const storage = fakeStorage();
    const first = createLedger({ storage });
    first.record(parseHistory([...sell('a', 1, 2, 0, 'old'), ...sell('a', 1, 3, 0, 'new')]));

    const second = createLedger({ storage });
    second.record(parseHistory(sell('a', 1, 3, 0, 'new'))); // truncated feed
    expect(second.size()).toBe(2);
  });

  it('persists across instances', () => {
    const storage = fakeStorage();
    createLedger({ storage }).record(parseHistory(sell('stardust', 11, 25, 0, 'x')));
    expect(createLedger({ storage }).size()).toBe(1);
  });

  it('starts fresh rather than throwing on corrupt storage', () => {
    const storage = fakeStorage();
    storage.setItem('fmp-market-plus:ledger', '{not json');
    expect(() => createLedger({ storage })).not.toThrow();
    expect(createLedger({ storage }).size()).toBe(0);
  });

  it('works with no storage at all', () => {
    const ledger = createLedger({ storage: null });
    expect(ledger.record(parseHistory(sell('a', 1, 2, 0, 'x')))).toBe(1);
  });

  it('returns an item\'s trades newest first', () => {
    const ledger = createLedger({ storage: fakeStorage() });
    ledger.record(parseHistory([...sell('a', 1, 2, 0, '2026-06-01'), ...sell('a', 1, 3, 0, '2026-09-01')]));
    expect(ledger.tradesFor('a').map((t) => t.completedAt)).toEqual(['2026-09-01', '2026-06-01']);
  });

  it('does not mix items together', () => {
    const ledger = createLedger({ storage: fakeStorage() });
    ledger.record(parseHistory([...sell('a', 1, 2, 0, 'x'), ...sell('b', 1, 2, 0, 'x')]));
    expect(ledger.tradesFor('a')).toHaveLength(1);
  });
});

describe('summarise', () => {
  it('totals sales and averages the price by unit', () => {
    const trades = parseHistory([
      ...sell('a', 10, 100, 0, 'x'),
      ...sell('a', 20, 100, 0, 'y'),
    ]);
    const s = summarise(trades);
    expect(s).toMatchObject({ soldUnits: 200, soldGross: 3000, avgSalePrice: 15 });
  });

  it('subtracts tax to give net proceeds', () => {
    const s = summarise(parseHistory(sell('a', 1000, 10, 100, 'x')));
    expect(s.soldNet).toBe(10_000 - 100);
  });

  it('reports profit as unavailable when nothing was ever bought', () => {
    // Revenue is not profit: without a cost basis it would overstate by
    // exactly what the goods cost to acquire.
    const s = summarise(parseHistory(sell('a', 10, 100, 0, 'x')));
    expect(s.costBasisKnown).toBe(false);
    expect(s.realised).toBeNull();
  });

  it('computes realised profit once purchases exist', () => {
    const s = summarise(
      parseHistory([...buy('a', 10, 100, 'x'), ...sell('a', 15, 100, 0, 'y')])
    );
    expect(s.costBasisKnown).toBe(true);
    expect(s.avgCostBasis).toBe(10);
    expect(s.realised).toBe(500);
  });

  it('only counts units actually covered by a purchase', () => {
    // Bought 50, sold 100: just 50 units have a known cost.
    const s = summarise(
      parseHistory([...buy('a', 10, 50, 'x'), ...sell('a', 15, 100, 0, 'y')])
    );
    expect(s.matchedUnits).toBe(50);
    expect(s.realised).toBe(250);
  });

  it('charges tax against realised profit proportionally', () => {
    const s = summarise(
      parseHistory([...buy('a', 100, 10, 'x'), ...sell('a', 200, 10, 20, 'y')])
    );
    expect(s.realised).toBe(10 * (200 - 100) - 20);
  });

  it('handles an empty ledger', () => {
    expect(summarise([])).toMatchObject({ trades: 0, soldUnits: 0, avgSalePrice: null, realised: null });
  });
});

describe('loading a store written before orders were keyed properly', () => {
  it('collapses old per-snapshot entries to the largest', () => {
    const storage = fakeStorage();
    // Hand-write a store shaped like the old format: one entry per fill.
    storage.setItem(
      'fmp-market-plus:ledger',
      JSON.stringify({
        version: 1,
        entries: [
          { itemName: 'unpowered_orb', price: 83, amount: 67451, tax: 0, direction: 'sell', completedAt: '2026-09-08' },
          { itemName: 'unpowered_orb', price: 83, amount: 391, tax: 0, direction: 'sell', completedAt: '2026-09-08' },
          { itemName: 'unpowered_orb', price: 83, amount: 25, tax: 0, direction: 'sell', completedAt: '2026-09-08' },
        ],
      })
    );
    const ledger = createLedger({ storage });
    expect(ledger.tradesFor('unpowered_orb')).toHaveLength(1);
    // Not 25, which is what serialisation order alone would have left behind.
    expect(ledger.summaryFor('unpowered_orb').soldUnits).toBe(67_451);
  });
});
