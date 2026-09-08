import { describe, it, expect } from 'vitest';
import { summarise, priceVerdict, compareToAverage, suggestedPrice } from '../src/valuation.js';

// Shaped like a real GET /api/market/item/:name response.
const detail = {
  item_name: 'stardust',
  best_buy: 6,
  best_sell: 11,
  stats: {
    '24h': { volume: 0, sold: 0, trades: 0, avg_price: null },
    '7d': { volume: 11_375_000, sold: 1_675_000, trades: 2, avg_price: 6.791044776119403 },
  },
};

describe('summarise', () => {
  it('defaults to the 7d period', () => {
    expect(summarise(detail)).toMatchObject({ period: '7d', bestBuy: 6, bestSell: 11, spread: 5 });
  });

  it('selects the requested period', () => {
    expect(summarise(detail, '24h').avgPrice).toBeNull();
  });

  it('carries a null average through rather than inventing one', () => {
    // A period with no trades has no average; substituting a book price would
    // make an untraded item look benchmarked when it is not.
    expect(summarise(detail, '24h').avgPrice).toBeNull();
  });

  it('survives a missing or unknown period', () => {
    expect(summarise(detail, 'nope')).toMatchObject({ avgPrice: null, volume: null });
    expect(summarise({})).toMatchObject({ bestBuy: null, bestSell: null, spread: null });
    expect(summarise(null)).toBeNull();
  });
});

describe('priceVerdict', () => {
  const summary = summarise(detail);

  it('says a sell at or below the best buy fills now', () => {
    expect(priceVerdict({ price: 6, direction: 'sell', summary })).toMatchObject({
      fills: true,
      tone: 'good',
    });
    expect(priceVerdict({ price: 5, direction: 'sell', summary }).fills).toBe(true);
  });

  it('says a sell above the best buy has to wait', () => {
    expect(priceVerdict({ price: 7, direction: 'sell', summary }).fills).toBe(false);
  });

  it('says a buy at or above the best sell fills now', () => {
    expect(priceVerdict({ price: 11, direction: 'buy', summary }).fills).toBe(true);
    expect(priceVerdict({ price: 12, direction: 'buy', summary }).fills).toBe(true);
  });

  it('says a buy below the best sell has to wait', () => {
    expect(priceVerdict({ price: 10, direction: 'buy', summary }).fills).toBe(false);
  });

  it('describes queue position against the same side', () => {
    // 7 is below the best sell of 11, so it jumps the sell queue.
    expect(priceVerdict({ price: 7, direction: 'sell', summary }).headline).toMatch(/undercuts/i);
    // 5 is below the best buy of 6, so it sits behind it.
    expect(priceVerdict({ price: 5, direction: 'buy', summary }).headline).toMatch(/behind/i);
  });

  it('warns when the opposite side of the book is empty', () => {
    const empty = summarise({ best_buy: null, best_sell: 11, stats: {} });
    expect(priceVerdict({ price: 50, direction: 'sell', summary: empty })).toMatchObject({
      fills: false,
      tone: 'warn',
    });
  });

  it('refuses to judge without a usable price or direction', () => {
    expect(priceVerdict({ price: 0, direction: 'sell', summary }).tone).toBe('unknown');
    expect(priceVerdict({ price: 5, direction: 'sideways', summary }).tone).toBe('unknown');
    expect(priceVerdict({ price: 5, direction: 'sell', summary: null }).tone).toBe('unknown');
  });
});

describe('compareToAverage', () => {
  it('reports the percentage gap from the average', () => {
    expect(compareToAverage(10, 5)).toMatchObject({ percent: 100 });
    expect(compareToAverage(4, 5).percent).toBeCloseTo(-20);
  });

  it('signs the label', () => {
    expect(compareToAverage(10, 5).label).toMatch(/^\+100\.0%/);
    expect(compareToAverage(4, 5).label).toMatch(/^-20\.0%/);
  });

  it('is null when there is no average to compare against', () => {
    expect(compareToAverage(10, null)).toBeNull();
    expect(compareToAverage(10, 0)).toBeNull();
  });
});

describe('suggestedPrice', () => {
  const summary = summarise(detail); // best_buy 6, best_sell 11

  it('undercuts the best sell by one', () => {
    expect(suggestedPrice({ direction: 'sell', summary })).toBe(10);
  });

  it('outbids the best buy by one', () => {
    expect(suggestedPrice({ direction: 'buy', summary })).toBe(7);
  });

  it('will not undercut into the bid', () => {
    // best buy 9, best sell 10: undercutting to 9 would sell at the bid, so
    // matching the bid is the honest suggestion rather than going below it.
    const tight = summarise({ best_buy: 9, best_sell: 10, stats: {} });
    expect(suggestedPrice({ direction: 'sell', summary: tight })).toBe(9);
  });

  it('will not outbid past the ask', () => {
    const tight = summarise({ best_buy: 9, best_sell: 10, stats: {} });
    expect(suggestedPrice({ direction: 'buy', summary: tight })).toBe(10);
  });

  it('is null when that side of the book is empty', () => {
    const oneSided = summarise({ best_buy: null, best_sell: null, stats: {} });
    expect(suggestedPrice({ direction: 'sell', summary: oneSided })).toBeNull();
    expect(suggestedPrice({ direction: 'buy', summary: oneSided })).toBeNull();
  });

  it('never suggests a price below one', () => {
    const cheap = summarise({ best_buy: null, best_sell: 1, stats: {} });
    expect(suggestedPrice({ direction: 'sell', summary: cheap })).toBeNull();
  });
});
