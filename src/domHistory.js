/**
 * Recovering transactions the plugin was not running to hear.
 *
 * FlatMMO+ hooks the WebSocket after login, so a REFRESH_MARKET_UI_HISTORY
 * frame sent during startup -- which happens whenever the market panel is
 * already open as the page loads -- is never seen by any plugin. The game has
 * already rendered those transactions, though, so they can be read back out of
 * its own markup.
 *
 * This is a lossy source: the rendered line carries the total coins rather than
 * the unit price, and no tax at all. Entries from here are therefore marked
 * `provisional`, and a real frame carrying the same transaction replaces them.
 */

/**
 * Parse one rendered line, e.g. "25 Unpowered Orb sold for 2,075 coins2026-09-08".
 * `itemName` comes from the row's icon, since the display name is not reversible.
 */
export function parseHistoryLine(itemName, text) {
  if (!itemName || typeof text !== 'string') return null;

  const amountMatch = text.match(/^\s*([\d,]+)\s/);
  const actionMatch = text.match(/\s(sold|bought)\s+for\s+([\d,]+)\s+coins/i);
  const dateMatch = text.match(/(\d{4}-\d{2}-\d{2}(?:[ T][\d:.]+)?)\s*$/);
  if (!amountMatch || !actionMatch) return null;

  const amount = toInt(amountMatch[1]);
  const total = toInt(actionMatch[2]);
  if (!amount || amount <= 0 || !Number.isFinite(total)) return null;

  // The rendered line only has the total, so the unit price is recovered by
  // division. It divides evenly for every observed row; rounding covers the
  // case where it does not, and the entry stays provisional regardless.
  const price = Math.round(total / amount);

  return {
    itemName,
    price,
    amount,
    tax: 0,
    direction: actionMatch[1].toLowerCase() === 'bought' ? 'buy' : 'sell',
    completedAt: dateMatch ? dateMatch[1] : '',
    provisional: true,
  };
}

/** Read every transaction the game has currently rendered in its history panel. */
export function readRenderedHistory(doc = document) {
  const rows = doc.querySelectorAll('#global-market-history .market-ui-posting-history');
  const out = [];
  for (const row of rows) {
    const src = row.querySelector('img')?.getAttribute('src') || '';
    const itemName = src.split('/').pop()?.replace(/\.png$/i, '') || '';
    const entry = parseHistoryLine(itemName, row.textContent.replace(/\s+/g, ' ').trim());
    if (entry) out.push(entry);
  }
  return out;
}

function toInt(s) {
  return Number.parseInt(String(s).replace(/,/g, ''), 10);
}
