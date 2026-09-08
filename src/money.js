/**
 * Market money math.
 *
 * Every rule here was derived from 4,402 real order records in the flatstats
 * database (table `market_history`), not from documentation:
 *
 *  - Tax is charged on the SELL side only. All 2,201 buy-side rows had tax = 0,
 *    so a buyer pays exactly price * quantity and buy-side MAX needs no
 *    tax adjustment whatsoever.
 *  - The threshold is `price >= 100`, inclusive. 119 rows priced at exactly 100
 *    were taxed; every row below 100 (624 of them) was not.
 *  - The rate is 1%, but it is floored PER FILL rather than on the order total.
 *    A limit order is filled by multiple counterparties in quantity chunks and
 *    each chunk's 1% is floored independently, so the true total is at most
 *    floor(price * quantity / 100) and can be a coin or two under it.
 *    1,570 of 1,577 taxed rows matched the whole-order figure exactly; the
 *    seven that didn't were all short by 1-2 coins, never over.
 */

/** Unit price at or above which sell-side tax applies. */
export const TAX_THRESHOLD = 100;

/** Sell-side tax rate, as a fraction. */
export const TAX_RATE = 0.01;

/**
 * Upper bound on the tax a sell order will pay.
 *
 * Because the game floors the 1% per fill, the real figure can land a coin or
 * two below this. Erring high means estimated proceeds are never overstated,
 * which is the safe direction for a seller deciding whether a listing is worth
 * posting.
 */
export function estimateSellTax(price, quantity) {
  if (!isPositive(price) || !isPositive(quantity)) return 0;
  if (price < TAX_THRESHOLD) return 0;
  return Math.floor((price * quantity) / 100);
}

/** Total coins a buy order removes from the bank. Buyers are never taxed. */
export function buyOrderCost(price, quantity) {
  if (!isPositive(price) || !isPositive(quantity)) return 0;
  return price * quantity;
}

/**
 * Coins a sell order returns once fully filled, after tax.
 * Conservative: see estimateSellTax.
 */
export function sellNetProceeds(price, quantity) {
  if (!isPositive(price) || !isPositive(quantity)) return 0;
  return price * quantity - estimateSellTax(price, quantity);
}

/**
 * Largest quantity affordable at `price` given `coins` on hand.
 * Returns 0 when the price is missing or the player cannot afford a single one.
 */
export function maxBuyQuantity(coins, price) {
  if (!isPositive(price) || !isPositive(coins)) return 0;
  return Math.floor(coins / price);
}

/**
 * Largest quantity sellable: whatever is in the bank.
 *
 * The market draws from the bank, not the inventory, so this must be fed the
 * bank figure the server sends in CHANGED_MARKET_ITEM_POSTING_UI_SELECT --
 * never the result of the game's own get_item_amount(), which reads inventory.
 */
export function maxSellQuantity(bankAmount) {
  if (!isPositive(bankAmount)) return 0;
  return Math.floor(bankAmount);
}

function isPositive(n) {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

/**
 * Market versus vendor for a quantity of goods.
 *
 * Low-value items are frequently worth more to a vendor than to the market once
 * the sale is netted out, and the game gives no hint of this -- so a player can
 * tie up a market slot for days on something a shopkeeper would buy instantly
 * for more. `vendorPrice` comes from the game's own item_sell_prices global.
 */
export function compareToVendor({ price, quantity, vendorPrice }) {
  if (!isPositive(quantity)) return null;
  if (!isPositive(vendorPrice)) return null;

  const vendorTotal = vendorPrice * quantity;
  const marketNet = isPositive(price) ? sellNetProceeds(price, quantity) : null;

  if (marketNet === null) return { vendorTotal, marketNet: null, better: null, ratio: null };

  return {
    vendorTotal,
    marketNet,
    better: marketNet > vendorTotal ? 'market' : marketNet < vendorTotal ? 'vendor' : 'equal',
    ratio: vendorTotal > 0 ? marketNet / vendorTotal : null,
  };
}
