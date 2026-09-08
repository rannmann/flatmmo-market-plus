import { describe, it, expect } from 'vitest';
import {
  TAX_THRESHOLD,
  estimateSellTax,
  buyOrderCost,
  sellNetProceeds,
  maxBuyQuantity,
  maxSellQuantity,
  compareToVendor,
} from '../src/money.js';

describe('estimateSellTax', () => {
  it('charges nothing below the threshold', () => {
    expect(estimateSellTax(99, 1000)).toBe(0);
    expect(estimateSellTax(1, 10_000_000)).toBe(0);
  });

  it('charges at exactly 100, which is the inclusive boundary', () => {
    // 119 rows priced at exactly 100 were taxed in the observed data.
    expect(estimateSellTax(TAX_THRESHOLD, 100)).toBe(100);
  });

  it('is 1% of the order total', () => {
    expect(estimateSellTax(1000, 500)).toBe(5000);
    expect(estimateSellTax(250_000, 3)).toBe(7500);
  });

  it('ignores nonsense input rather than producing NaN', () => {
    expect(estimateSellTax(NaN, 10)).toBe(0);
    expect(estimateSellTax(100, 0)).toBe(0);
    expect(estimateSellTax(-100, 10)).toBe(0);
    expect(estimateSellTax('100', 10)).toBe(0);
  });

  // The game floors 1% per fill, so the whole-order figure is an upper bound.
  // These are real rows from market_history whose recorded tax came in under it.
  describe.each([
    { item: 'raw_tuna', price: 120, qty: 200, actual: 239 },
    { item: 'raw_shark', price: 1049, qty: 5000, actual: 52_449 },
    { item: 'ashes', price: 220, qty: 12_612, actual: 27_745 },
    { item: 'hatching_chicken_sigil', price: 3_899_999, qty: 3, actual: 116_997 },
  ])('$item', ({ price, qty, actual }) => {
    it('never underestimates the real tax', () => {
      expect(estimateSellTax(price, qty)).toBeGreaterThanOrEqual(actual);
    });

    it('stays within a couple of coins of it', () => {
      expect(estimateSellTax(price, qty) - actual).toBeLessThanOrEqual(2);
    });
  });
});

describe('buyOrderCost', () => {
  it('is untaxed even well above the sell-side threshold', () => {
    // All 2,201 observed buy-side rows had tax = 0.
    expect(buyOrderCost(1_000_000, 5)).toBe(5_000_000);
  });
});

describe('sellNetProceeds', () => {
  it('returns the full amount when under the threshold', () => {
    expect(sellNetProceeds(99, 100)).toBe(9900);
  });

  it('deducts tax at and above the threshold', () => {
    expect(sellNetProceeds(100, 100)).toBe(10_000 - 100);
  });
});

describe('maxBuyQuantity', () => {
  it('floors to whole units', () => {
    expect(maxBuyQuantity(1000, 300)).toBe(3);
  });

  it('is zero when a single unit is unaffordable', () => {
    expect(maxBuyQuantity(50, 100)).toBe(0);
  });

  it('is zero when no price is set yet', () => {
    expect(maxBuyQuantity(1000, 0)).toBe(0);
    expect(maxBuyQuantity(1000, NaN)).toBe(0);
  });

  it('does not adjust for tax, because buyers are not taxed', () => {
    expect(maxBuyQuantity(10_000, 100)).toBe(100);
  });
});

describe('maxSellQuantity', () => {
  it('is the whole bank stock', () => {
    expect(maxSellQuantity(14_687)).toBe(14_687);
  });

  it('is zero for an empty or missing bank figure', () => {
    expect(maxSellQuantity(0)).toBe(0);
    expect(maxSellQuantity(undefined)).toBe(0);
  });
});

describe('compareToVendor', () => {
  it('prefers the market when it nets more', () => {
    // Unpowered orb: vendor 5, market 83.
    const c = compareToVendor({ price: 83, quantity: 100, vendorPrice: 5 });
    expect(c).toMatchObject({ vendorTotal: 500, marketNet: 8300, better: 'market' });
  });

  it('prefers the vendor when the market nets less', () => {
    const c = compareToVendor({ price: 3, quantity: 100, vendorPrice: 5 });
    expect(c).toMatchObject({ vendorTotal: 500, marketNet: 300, better: 'vendor' });
  });

  it('accounts for tax when deciding', () => {
    // 100 each x 10 = 1000 gross, less 1% tax = 990, under a 100/unit vendor.
    const c = compareToVendor({ price: 100, quantity: 10, vendorPrice: 100 });
    expect(c.marketNet).toBe(990);
    expect(c.better).toBe('vendor');
  });

  it('reports the vendor total before a price is entered', () => {
    const c = compareToVendor({ price: NaN, quantity: 100, vendorPrice: 5 });
    expect(c).toMatchObject({ vendorTotal: 500, marketNet: null, better: null });
  });

  it('is null for items a vendor will not buy', () => {
    expect(compareToVendor({ price: 10, quantity: 5, vendorPrice: 0 })).toBeNull();
    expect(compareToVendor({ price: 10, quantity: 5, vendorPrice: undefined })).toBeNull();
  });
});
