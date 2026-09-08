/**
 * Recovering live orders the plugin was not running to hear.
 *
 * Same gap as domHistory.js: FlatMMO+ hooks the WebSocket after login, so a
 * REFRESH_MARKET_UI_POSTINGS frame sent during startup -- which happens whenever
 * the market panel is already open as the page loads -- reaches no plugin. The
 * game has already rendered those listings, and unlike the history panel it
 * renders everything needed, including each order's uuid in its own button
 * handlers. So this recovery is lossless and the entries are not provisional.
 */

/** Pull the uuid out of `cancel_market_offer("...")` or `collect_market_offer("...")`. */
export function extractUuid(onclickValues) {
  for (const raw of onclickValues || []) {
    const m = String(raw).match(/(?:cancel|collect)_market_offer\(\s*["']([0-9a-f-]{16,})["']/i);
    if (m) return m[1];
  }
  return null;
}

/**
 * Parse one rendered listing, e.g.
 * "sell Stardust 2026-09-07 13:41:49 27/14687 sold 11 each 0 coins to collect".
 */
export function parsePostingLine({ itemName, uuid, text }) {
  if (!itemName || !uuid || typeof text !== 'string') return null;

  const fill = text.match(/([\d,]+)\s*\/\s*([\d,]+)\s+(sold|bought)/i);
  const price = text.match(/([\d,]+)\s+each/i);
  const created = text.match(/(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2})/);
  if (!fill || !price) return null;

  const amountSold = toInt(fill[1]);
  const amount = toInt(fill[2]);
  const unit = toInt(price[1]);
  if (!Number.isFinite(amountSold) || !Number.isFinite(amount) || !Number.isFinite(unit)) return null;

  return {
    uuid,
    itemName,
    price: unit,
    amount,
    amountSold,
    // The rendered word is the game's own label for the direction.
    direction: fill[3].toLowerCase() === 'bought' ? 'buy' : 'sell',
    createdAt: created ? created[1] : '',
  };
}

/** Read every listing the game currently has rendered. */
export function readRenderedPostings(doc = document) {
  const rows = doc.querySelectorAll('#global-market-postings .market-ui-posting');
  const out = [];
  for (const row of rows) {
    const src = row.querySelector('img')?.getAttribute('src') || '';
    const itemName = src.split('/').pop()?.replace(/\.png$/i, '') || '';
    const uuid = extractUuid(
      [...row.querySelectorAll('[onclick]')].map((e) => e.getAttribute('onclick'))
    );
    const order = parsePostingLine({
      itemName,
      uuid,
      text: row.textContent.replace(/\s+/g, ' ').trim(),
    });
    if (order) out.push(order);
  }
  return out;
}

function toInt(s) {
  return Number.parseInt(String(s).replace(/,/g, ''), 10);
}
