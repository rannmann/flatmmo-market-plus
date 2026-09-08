/**
 * Parsing for the game's market WebSocket frames.
 *
 * Frames arrive as `COMMAND=v0~v1~v2...`. FlatMMO+ hands plugins the raw string
 * via onMessageReceived, so the plugin re-parses rather than reaching into the
 * game's own switch statement.
 */

/** Frames this plugin cares about. */
export const MARKET_COMMANDS = {
  OPEN: 'OPEN_MARKET_UI',
  ITEM_SELECTED: 'CHANGED_MARKET_ITEM_POSTING_UI_SELECT',
  POSTINGS: 'REFRESH_MARKET_UI_POSTINGS',
  HISTORY: 'REFRESH_MARKET_UI_HISTORY',
  STATS: 'REFRESH_MARKET_UI_SPENDING_STATS',
  LOADING: 'REFRESH_MARKET_UI_POSTINGS_LOADING_SCREEN',
};

/**
 * Split a raw frame into its command and values.
 * Returns null for anything that isn't a `COMMAND=...` string.
 */
export function parseFrame(raw) {
  if (typeof raw !== 'string') return null;
  const split = raw.indexOf('=');
  if (split === -1) return null;
  const command = raw.slice(0, split);
  if (!command) return null;
  const rest = raw.slice(split + 1);
  return { command, values: rest === '' ? [] : rest.split('~') };
}

/**
 * CHANGED_MARKET_ITEM_POSTING_UI_SELECT = item ~ bankAmount ~ coins
 *
 * This is the frame that makes MAX possible: the server volunteers both the
 * player's bank stock of the selected item and their spendable coins, and the
 * stock client throws both away after printing one line of text.
 */
export function parseItemSelected(values) {
  if (!Array.isArray(values) || values.length < 3) return null;
  const item = values[0];
  const bankAmount = Number.parseInt(values[1], 10);
  const coins = Number.parseInt(values[2], 10);
  if (!item || Number.isNaN(bankAmount) || Number.isNaN(coins)) return null;
  return { item, bankAmount, coins };
}

/** Field order of one listing inside REFRESH_MARKET_UI_POSTINGS. */
const POSTING_FIELDS = [
  'id',
  'itemName',
  'price',
  'amount',
  'amountSold',
  'toCollect',
  'status',
  'createdAt',
  'direction',
  'uuid',
  'refundAmount',
];

/**
 * REFRESH_MARKET_UI_POSTINGS sends the player's own listings as repeating
 * groups of 11 fields, or the single value "none" when there are none.
 *
 * A trailing partial group is dropped rather than emitted half-filled: the
 * game's own reader would run off the end of the array in that case, so a
 * short tail means the frame is malformed and the remainder is not trustworthy.
 */
export function parsePostings(values) {
  if (!Array.isArray(values) || values.length === 0) return [];
  if (values[0] === 'none') return [];

  const postings = [];
  const size = POSTING_FIELDS.length;
  for (let i = 0; i + size <= values.length; i += size) {
    const posting = {};
    for (let f = 0; f < size; f++) {
      posting[POSTING_FIELDS[f]] = values[i + f];
    }
    posting.price = Number.parseInt(posting.price, 10);
    posting.amount = Number.parseInt(posting.amount, 10);
    posting.amountSold = Number.parseInt(posting.amountSold, 10);
    posting.toCollect = Number.parseInt(posting.toCollect, 10);
    postings.push(posting);
  }
  return postings;
}

/** Field order of one transaction inside REFRESH_MARKET_UI_HISTORY. */
const HISTORY_FIELDS = ['itemName', 'price', 'amount', 'tax', 'direction', 'completedAt'];

/**
 * REFRESH_MARKET_UI_HISTORY sends the player's own completed transactions as
 * repeating groups of 6, or the single value "none" when there are none.
 *
 * Observed in the live client: only sell-direction records appear, even for a
 * player whose panel reports coins spent. The parser handles `buy` anyway, so
 * purchases start being recorded the moment the server sends any.
 */
export function parseHistory(values) {
  if (!Array.isArray(values) || values.length === 0) return [];
  if (values[0] === 'none') return [];

  const out = [];
  const size = HISTORY_FIELDS.length;
  for (let i = 0; i + size <= values.length; i += size) {
    const entry = {};
    for (let f = 0; f < size; f++) entry[HISTORY_FIELDS[f]] = values[i + f];
    entry.price = Number.parseInt(entry.price, 10);
    entry.amount = Number.parseInt(entry.amount, 10);
    entry.tax = Number.parseInt(entry.tax, 10) || 0;
    if (!entry.itemName || Number.isNaN(entry.price) || Number.isNaN(entry.amount)) continue;
    if (entry.direction !== 'buy' && entry.direction !== 'sell') continue;
    out.push(entry);
  }
  return out;
}

/**
 * A stable identity for one ORDER -- deliberately excluding `amount`.
 *
 * The feed reports open orders with a sold-count that grows as they fill, and
 * re-sends them whole on every refresh. One listing was observed reported as
 * 25, then 391, then 67,451 of the same order on the same day. Keying on the
 * amount made each snapshot a separate record and tripled that sale.
 *
 * Excluding it collapses the snapshots onto one another. Measured against the
 * player's collected coins plus coins awaiting collection, this cut the total
 * error from 7,769,984 to 1,222,567 -- so it is substantially closer, though
 * the feed still does not reconcile exactly with the panel's own Sales figure.
 *
 * The cost: two genuinely separate orders of the same item at the same price
 * bearing the same timestamp merge into one, and the larger wins. That
 * understates rather than inflates, which is the safer direction to be wrong.
 */
export function historyKey(entry) {
  return [entry.itemName, entry.direction, entry.price, entry.completedAt].join('|');
}
