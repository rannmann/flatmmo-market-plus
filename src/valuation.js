/**
 * Turning flatstats market data into a verdict on a proposed price.
 *
 * All orders are limit orders that must match exactly, so "will this fill?" is
 * a straight comparison against the opposite side of the book, and is knowable
 * with certainty. Whether the price is *good* is a judgement against recent
 * trade history, and is reported as such -- never as a recommendation.
 */

/**
 * Pull the few numbers a verdict needs out of a flatstats item-detail payload.
 *
 * `stats` is keyed by period ('24h', '7d'), and a period with no trades reports
 * avg_price as null -- a thinly traded item genuinely has no recent average, so
 * that null is carried through rather than substituted with a book price.
 */
export function summarise(detail, period = '7d') {
  if (!detail || typeof detail !== 'object') return null;
  const bestBuy = numberOrNull(detail.best_buy);
  const bestSell = numberOrNull(detail.best_sell);
  const allStats = detail.stats && typeof detail.stats === 'object' ? detail.stats : {};
  const stats = allStats[period] && typeof allStats[period] === 'object' ? allStats[period] : {};
  return {
    period,
    bestBuy,
    bestSell,
    avgPrice: numberOrNull(stats.avg_price),
    volume: numberOrNull(stats.volume),
    unitsSold: numberOrNull(stats.sold),
    spread: bestBuy !== null && bestSell !== null ? bestSell - bestBuy : null,
  };
}

/**
 * Judge a proposed listing.
 *
 * `direction` is the player's own side: 'sell' means they are posting a sell
 * order, so it fills against the best BUY order on the book.
 *
 * Returns a `fills` flag (certain), plus an optional `comparison` against the
 * recent average (a judgement, and absent when there is no trade history).
 */
export function priceVerdict({ price, direction, summary }) {
  if (!Number.isFinite(price) || price <= 0 || !summary) {
    return { fills: null, tone: 'unknown', headline: 'Enter a price', comparison: null };
  }
  if (direction !== 'buy' && direction !== 'sell') {
    return { fills: null, tone: 'unknown', headline: 'Pick buy or sell', comparison: null };
  }

  const opposite = direction === 'sell' ? summary.bestBuy : summary.bestSell;
  const sameSide = direction === 'sell' ? summary.bestSell : summary.bestBuy;

  let fills = null;
  let headline;
  let tone;

  if (opposite === null) {
    fills = false;
    headline = direction === 'sell' ? 'Nobody is buying this' : 'Nobody is selling this';
    tone = 'warn';
  } else if (direction === 'sell' ? price <= opposite : price >= opposite) {
    fills = true;
    headline = `Fills now against ${formatCoins(opposite)}`;
    tone = 'good';
  } else {
    fills = false;
    headline = queuePosition(price, sameSide, direction);
    tone = 'neutral';
  }

  return { fills, tone, headline, comparison: compareToAverage(price, summary.avgPrice) };
}

/** Where this price sits relative to the best order on the player's own side. */
function queuePosition(price, sameSide, direction) {
  if (sameSide === null) return 'First order on this side';
  if (direction === 'sell') {
    if (price < sameSide) return `Undercuts the best sell (${formatCoins(sameSide)})`;
    if (price === sameSide) return `Ties the best sell (${formatCoins(sameSide)})`;
    return `Behind the best sell (${formatCoins(sameSide)})`;
  }
  if (price > sameSide) return `Outbids the best buy (${formatCoins(sameSide)})`;
  if (price === sameSide) return `Ties the best buy (${formatCoins(sameSide)})`;
  return `Behind the best buy (${formatCoins(sameSide)})`;
}

/**
 * Percentage difference from the recent sold-weighted average.
 * Returns null when there is no history to compare against, rather than
 * inventing a baseline.
 */
export function compareToAverage(price, avgPrice) {
  if (!Number.isFinite(price) || price <= 0) return null;
  if (!Number.isFinite(avgPrice) || avgPrice <= 0) return null;
  const pct = ((price - avgPrice) / avgPrice) * 100;
  return {
    avgPrice,
    percent: pct,
    label: `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}% vs ${formatCoins(Math.round(avgPrice))} avg`,
  };
}

export function formatCoins(n) {
  if (!Number.isFinite(n)) return '?';
  return n.toLocaleString('en-US');
}

function numberOrNull(v) {
  return Number.isFinite(v) ? v : null;
}

/**
 * A price that would place the order at the front of its side of the book.
 *
 * Selling: one under the current best sell, so it is first to fill -- but never
 * at or below the best buy, since that would fill instantly at a worse price
 * than simply matching the buy order. Buying: one over the best buy.
 *
 * Returns null when the relevant side is empty and there is nothing to undercut.
 */
export function suggestedPrice({ direction, summary }) {
  if (!summary) return null;

  if (direction === 'sell') {
    if (summary.bestSell === null) return null;
    const undercut = summary.bestSell - 1;
    // Undercutting into or below the bid means selling cheaper than the market
    // is already willing to pay; matching the bid is strictly better.
    if (summary.bestBuy !== null && undercut <= summary.bestBuy) return summary.bestBuy;
    return undercut >= 1 ? undercut : null;
  }

  if (direction === 'buy') {
    if (summary.bestBuy === null) return null;
    const outbid = summary.bestBuy + 1;
    if (summary.bestSell !== null && outbid >= summary.bestSell) return summary.bestSell;
    return outbid;
  }

  return null;
}
