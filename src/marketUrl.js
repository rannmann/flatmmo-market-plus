/**
 * Recognising the market.flatmmo.com links the game opens in a new tab.
 *
 * The game hard-codes `window.open("https://market.flatmmo.com/market/listing/
 * <item>/view/", "_blank")` on inline onclick attributes, and uses the literal
 * item name "all" for the whole-market view. Matching the URL rather than the
 * element means re-rendered postings stay intercepted without re-scanning.
 */

const LISTING_PATTERN = /^https?:\/\/market\.flatmmo\.com\/market\/listing\/([a-z0-9_]+)\/view\/?/i;

/**
 * Classify a URL.
 * Returns `{ kind: 'all' }`, `{ kind: 'item', item }`, or null when the URL is
 * not a market listing page and should be left alone.
 */
export function parseMarketUrl(url) {
  if (typeof url !== 'string') return null;
  const match = url.match(LISTING_PATTERN);
  if (!match) return null;
  const name = match[1].toLowerCase();
  return name === 'all' ? { kind: 'all' } : { kind: 'item', item: name };
}

/** True when this URL is one the in-game browser can render itself. */
export function isMarketUrl(url) {
  return parseMarketUrl(url) !== null;
}
