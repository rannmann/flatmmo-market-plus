import { describe, it, expect } from 'vitest';
import { createOrderTracker, summariseOrders } from '../src/orders.js';
import { parsePostings } from '../src/protocol.js';

function fakeStorage() {
  const map = Object.create(null);
  return {
    getItem: (k) => (k in map ? map[k] : null),
    setItem: (k, v) => { map[k] = String(v); },
  };
}

/** Build a REFRESH_MARKET_UI_POSTINGS group, matching the live field order. */
const listing = ({ id = '1', item = 'unpowered_orb', price = 83, amount = 100, sold = 0,
  toCollect = 0, status = 'active', createdAt = '2026-09-08T17:38:32.447Z',
  direction = 'sell', uuid = 'u1', refund = 0 }) =>
  [id, item, String(price), String(amount), String(sold), String(toCollect), status,
   createdAt, direction, uuid, String(refund)];

describe('createOrderTracker', () => {
  it('records an order by uuid', () => {
    const t = createOrderTracker({ storage: fakeStorage() });
    expect(t.observe(parsePostings(listing({ sold: 25 })))).toBe(1);
    expect(t.summaryFor('unpowered_orb').soldUnits).toBe(25);
  });

  it('counts one order once no matter how often it is re-reported', () => {
    // The exact case the history feed gets wrong: 25, then 391, then 67,451.
    const t = createOrderTracker({ storage: fakeStorage() });
    for (const sold of [25, 391, 67_451]) {
      t.observe(parsePostings(listing({ sold, amount: 67_451, uuid: 'order-a' })));
    }
    const s = t.summaryFor('unpowered_orb');
    expect(t.size()).toBe(1);
    expect(s.soldUnits).toBe(67_451);
    expect(s.soldGross).toBe(67_451 * 83);
  });

  it('keeps two same-price same-day orders separate, unlike the history feed', () => {
    const t = createOrderTracker({ storage: fakeStorage() });
    t.observe(parsePostings([
      ...listing({ uuid: 'a', sold: 56_150, price: 89, amount: 56_150 }),
      ...listing({ uuid: 'b', sold: 56_378, price: 89, amount: 56_378 }),
    ]));
    expect(t.summaryFor('unpowered_orb').soldUnits).toBe(112_528);
  });

  it('ignores a stale snapshot that would walk the total backwards', () => {
    const t = createOrderTracker({ storage: fakeStorage() });
    t.observe(parsePostings(listing({ uuid: 'a', sold: 500 })));
    expect(t.observe(parsePostings(listing({ uuid: 'a', sold: 100 })))).toBe(0);
    expect(t.summaryFor('unpowered_orb').soldUnits).toBe(500);
  });

  it('excludes orders that have sold nothing', () => {
    const t = createOrderTracker({ storage: fakeStorage() });
    t.observe(parsePostings(listing({ uuid: 'a', sold: 0 })));
    expect(t.summaryFor('unpowered_orb').soldUnits).toBe(0);
    // Still tracked, so a later fill is recognised as the same order.
    expect(t.size()).toBe(1);
  });

  it('stamps when tracking began, and keeps it stable', () => {
    let clock = '2026-09-08T00:00:00.000Z';
    const t = createOrderTracker({ storage: fakeStorage(), now: () => clock });
    t.observe(parsePostings(listing({ sold: 1 })));
    clock = '2026-12-01T00:00:00.000Z';
    t.observe(parsePostings(listing({ sold: 2 })));
    expect(t.since()).toBe('2026-09-08T00:00:00.000Z');
  });

  it('persists across instances', () => {
    const storage = fakeStorage();
    createOrderTracker({ storage }).observe(parsePostings(listing({ sold: 40 })));
    expect(createOrderTracker({ storage }).summaryFor('unpowered_orb').soldUnits).toBe(40);
  });

  it('survives corrupt storage', () => {
    const storage = fakeStorage();
    storage.setItem('fmp-market-plus:orders', 'not json');
    expect(() => createOrderTracker({ storage })).not.toThrow();
  });
});

describe('summariseOrders', () => {
  const build = (rows) => parsePostings(rows.flatMap((r) => listing(r)));

  it('estimates sell tax from the verified rule', () => {
    const s = summariseOrders(build([{ uuid: 'a', price: 1000, amount: 10, sold: 10 }]));
    expect(s.soldGross).toBe(10_000);
    expect(s.soldTax).toBe(100);
    expect(s.soldNet).toBe(9_900);
  });

  it('charges no tax below a unit price of 100', () => {
    expect(summariseOrders(build([{ uuid: 'a', price: 83, amount: 10, sold: 10 }])).soldTax).toBe(0);
  });

  it('records purchases, which the history feed omits entirely', () => {
    const s = summariseOrders(build([
      { uuid: 'b', direction: 'buy', price: 81, amount: 100, sold: 100 },
    ]));
    expect(s).toMatchObject({ boughtUnits: 100, boughtSpend: 8100, costBasisKnown: true });
  });

  it('computes real profit once both sides exist', () => {
    const s = summariseOrders(build([
      { uuid: 'b', direction: 'buy', price: 80, amount: 100, sold: 100 },
      { uuid: 's', direction: 'sell', price: 90, amount: 100, sold: 100 },
    ]));
    expect(s.avgCostBasis).toBe(80);
    expect(s.avgSalePrice).toBe(90);
    expect(s.realised).toBe(1000);
  });

  it('only counts units actually covered by a purchase', () => {
    const s = summariseOrders(build([
      { uuid: 'b', direction: 'buy', price: 80, amount: 50, sold: 50 },
      { uuid: 's', direction: 'sell', price: 90, amount: 100, sold: 100 },
    ]));
    expect(s.matchedUnits).toBe(50);
    expect(s.realised).toBe(500);
  });

  it('reports profit as unavailable with sales alone', () => {
    const s = summariseOrders(build([{ uuid: 's', price: 90, amount: 10, sold: 10 }]));
    expect(s.costBasisKnown).toBe(false);
    expect(s.realised).toBeNull();
  });

  it('handles nothing tracked', () => {
    expect(summariseOrders([])).toMatchObject({ orders: 0, soldUnits: 0, realised: null });
  });
});
