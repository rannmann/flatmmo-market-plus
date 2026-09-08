# FlatMMO Market+

A [FlatMMO+](https://github.com/Dounford-Felipe/FlatMMOPlus) plugin that rebuilds
FlatMMO's Global Market UI, backed by market history from
[flatstats](https://flatstats.ravenwoodsoftware.org).

## Why

The stock market UI has the data but throws it away. When you pick an item to
post, the server sends your bank stock *and* your coin balance — and the client
prints one line of text with them. So there is no MAX button, no running total,
and no way to know whether the price you typed is reasonable. Meanwhile "view
price information" opens a second browser tab, and the item picker is a raw
`<datalist>` of snake_case names, so finding Unpowered Orb means knowing to type
`unpowered_orb`.

## What it does

- **MAX button** on the posting modal. Sell fills in your bank stock; buy fills
  in `floor(coins / price)`.
- **Live totals** as you type — total cost for a buy, gross/tax/net for a sell.
- **Price context** from flatstats: whether the order fills immediately, where it
  lands in the queue, and how the price compares to the recent average.
- **Input warnings** for values the game will mangle (see Quirks).
- **Your own trading record** per item: recent trades, units sold, net received,
  and your average sale price against the current market.
- **Vendor floor** — what a shopkeeper would pay for the same goods, so you
  don't tie up a market slot on something worth more to a vendor.
- **Suggested price** — one click to undercut the best sell (or outbid the best
  buy), never crossing the spread.
- **In-game order book** replacing the new-tab jump: order ladders with
  cumulative depth, a 7-day price chart, recent trades, and a browsable,
  filterable list of every item trading.

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) or Greasemonkey.
2. **[Install FlatMMO Market+](https://raw.githubusercontent.com/rannmann/flatmmo-market-plus/main/dist/flatmmo-market-plus.user.js)**
   — your script manager will offer to install it, and will keep it updated from
   the same URL.

FlatMMO+ itself is a prerequisite, but you do not have to install it separately:
if nothing on the page has already loaded it, this plugin fetches it for you.
If you would rather install it yourself, it is
[here](https://greasyfork.org/scripts/544062).

Settings live under the FlatMMO+ panel in game.

### Why this plugin does not `@require` FlatMMOPlus.js

Every other FlatMMO+ plugin pulls the framework in with `@require`. This one
does not: it waits for `window.FlatMMOPlus`, and injects a copy **only if
nothing else has provided one**. Installing it alone still works; installing it
alongside other plugins never loads a second framework.

That is deliberate. Tampermonkey caches `@require` content per script and only
refetches when that script updates, so plugins installed at different times each
carry their own frozen FMP build. There are also at least two publishing URLs in
circulation -- the wiki template uses openuserjs, while other plugins use
greasyfork -- which widens the spread further. FMP guards against initialising
twice with:

```js
if (pageWindow.FlatMMOPlus.version >= VERSION) return;
```

That is a *string* comparison, so `"1.5.4.1" >= "1.5.5"` is false. A copy newer
than the one already running skips the guard and takes the upgrade path instead:
it inherits the already-registered plugin list, then `init()` re-registers its
own `handler` into it and throws. Every other plugin is left with null configs:

```
Error: FlatMMOPlusPlugin with id "handler" is already registered.
TypeError: Cannot read properties of null (reading 'globalSettings')
TypeError: Cannot read properties of null (reading 'ignoredPlayers')
```

The comparison also misfires on ordinary bumps such as 1.5.9 -> 1.5.10. Until it
compares version segments numerically, the only reliable way for a plugin to
avoid triggering it is to not bring its own copy.

## Reference

- FlatMMO+ documentation: <https://flatmmo.wiki/index.php/Scrips:FlatMMO%2B>

## Development

```bash
npm install
npm test          # pure logic: money, protocol, valuation, search, parsing
npm run build     # bundle src/ -> dist/flatmmo-market-plus.user.js
npm run watch     # rebuild on change
```

The source is modular so the logic can be tested; `build.mjs` flattens it into
the single file a userscript has to be. Game-facing selectors and WebSocket
command names are confined to `src/protocol.js` and `src/ui/`, so a game update
breaks one feature rather than the whole plugin — every hook fails soft.

## Read-only

The plugin listens to market frames the server already sends and reads public
data from flatstats. It never posts, cancels, or collects an offer. The single
thing it writes is the amount field, when you click MAX; posting stays a
deliberate click on the game's own button.

## Verified game behaviour

These were derived from 4,402 real order records in the flatstats database
rather than from documentation, and the tests encode them:

- **Tax is sell-side only.** All 2,201 buy-side rows had `tax = 0`, so a buyer
  pays exactly `price × quantity`.
- **The threshold is `price >= 100`, inclusive.** Rows at exactly 100 were taxed;
  everything below 100 was not.
- **The 1% is floored per fill, not per order.** A limit order is filled by
  several counterparties in quantity chunks and each chunk's tax is floored
  independently, so the true total can land a coin or two under
  `floor(price × quantity / 100)`. Estimated proceeds therefore round against
  the seller and are never overstated.

## Quirks it warns about

The game's own `parseNumberInput` accepts a `b` suffix in its regex but only
defines multipliers for `k` and `m`, so typing `1b` produces `NaN` — which the
client then posts to the server as the literal string. It also rejects thousands
separators (`10,000` is `NaN`) and does not round, so `1.5` is accepted as a
quantity. The plugin mirrors this parser exactly so its arithmetic matches what
will actually be posted, and flags these cases instead of silently correcting
them.

## Profit and loss

Profit needs a cost basis, and the game's history feed currently reports **sells
only** -- a player whose panel shows millions spent still receives no `buy`
records. So realised P/L reads "no purchase record" rather than presenting
revenue as though it were profit, which would overstate it by exactly whatever
the goods cost to acquire.

The parser handles `buy` records regardless, and the ledger keeps everything it
has ever seen, so P/L becomes real the moment purchases start arriving -- either
because the game begins reporting them, or because you make one while the plugin
is running.

## A caveat on your lifetime totals

Per-item totals come from the game's history feed, and that feed does not
reconcile with the game's own `Sales` figure. Measured on a live account with
nothing pending collection:

| Source | Total |
| ------ | ----- |
| The game's HISTORY panel, summed | 29,619,927 |
| The game's own `Sales` stat | 16,251,213 |
| This plugin's ledger | 23,072,510 |

The feed re-reports an open order as its sold-count grows, so one listing was
observed as three rows -- 25, then 391, then 67,451 units of the same order on
the same day. The ledger collapses those, which is why its figure sits below the
raw feed, but it still exceeds `Sales` by 6.8M and the remainder is unexplained.

So treat lifetime totals as "what the game has reported", not as ground truth.
Individual trade rows are each real reported transactions, and the average sale
price is a ratio of two similarly-affected numbers, so both are more trustworthy
than the totals. A stable order id in the feed would resolve this completely and
let the merge heuristic be deleted.

## Storage

Two localStorage keys, both versioned:

- `fmp-market-plus:ledger` — your transactions, deduplicated by
  `item|direction|price|amount|timestamp`. The feed carries no transaction id, so
  two genuinely distinct trades sharing all five fields collapse into one. The
  store only ever grows, which means it survives the server truncating history.
- `fmp-market-plus:item-index` — item display names and icons, refreshed daily.

## Not done yet

- Liquidity estimate ("your 67,451 would take ~5 days at recent volume")
- Price-deviation flag against the 7-day mean
- Flip margin (buy at the ask, sell at the bid, net of tax)

## License

MIT
