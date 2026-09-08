// ==UserScript==
// @name         FlatMMO Market+
// @namespace    org.ravenwoodsoftware.flatmmo.marketplus
// @version      0.1.0
// @description  Rebuilds the FlatMMO Global Market UI: MAX buttons, live totals, and price history from flatstats
// @author       rannmann
// @license      MIT
// @match        *://flatmmo.com/play.php*
// @grant        none
// @homepageURL  https://github.com/rannmann/flatmmo-market-plus
// @supportURL   https://github.com/rannmann/flatmmo-market-plus/issues
// @downloadURL  https://raw.githubusercontent.com/rannmann/flatmmo-market-plus/main/dist/flatmmo-market-plus.user.js
// @updateURL    https://raw.githubusercontent.com/rannmann/flatmmo-market-plus/main/dist/flatmmo-market-plus.user.js
// ==/UserScript==

(() => {
  // src/flatstats.js
  var DEFAULT_BASE_URL = "https://flatstats.ravenwoodsoftware.org";
  var DEFAULT_TTL_MS = 6e4;
  var DEFAULT_TIMEOUT_MS = 8e3;
  function createFlatstatsClient({
    baseUrl = DEFAULT_BASE_URL,
    ttlMs = DEFAULT_TTL_MS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fetchImpl = globalThis.fetch?.bind(globalThis),
    now = () => Date.now()
  } = {}) {
    const cache = /* @__PURE__ */ Object.create(null);
    const inFlight = /* @__PURE__ */ Object.create(null);
    const root = String(baseUrl).replace(/\/+$/, "");
    async function request(path) {
      const cached = cache[path];
      if (cached && cached.expires > now()) return cached.value;
      const pending = inFlight[path];
      if (pending) return pending;
      const promise = (async () => {
        if (typeof fetchImpl !== "function") throw new Error("no fetch implementation available");
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const res = await fetchImpl(`${root}${path}`, {
            signal: controller.signal,
            credentials: "omit"
          });
          if (!res.ok) throw new Error(`flatstats ${path} responded ${res.status}`);
          const value = await res.json();
          cache[path] = { value, expires: now() + ttlMs };
          return value;
        } finally {
          clearTimeout(timer);
          delete inFlight[path];
        }
      })();
      inFlight[path] = promise;
      return promise;
    }
    return {
      /** Full detail for one item: book, history, trades, stats. */
      getItem(itemName, range = "7d") {
        if (!isSafeItemName(itemName)) return Promise.reject(new Error("invalid item name"));
        return request(`/api/market/item/${itemName}?range=${encodeURIComponent(range)}`);
      },
      /**
       * Every item definition the tracker knows about: name, display name, icon.
       * The limit is deliberately above the real count (~930) so this stays a
       * single request; the endpoint clamps to whatever actually exists.
       */
      async getItems(limit = 5e3) {
        const res = await request(`/api/items?limit=${limit}`);
        return Array.isArray(res?.items) ? res.items : [];
      },
      /** Every item with an active book, plus market-wide summary numbers. */
      getOverview(sort = "hot") {
        return request(`/api/market/overview?sort=${encodeURIComponent(sort)}`);
      },
      /** Drop cached responses so the next read is fresh. */
      clearCache() {
        for (const key of Object.keys(cache)) delete cache[key];
      }
    };
  }
  function isSafeItemName(name) {
    return typeof name === "string" && /^[a-z0-9_]+$/i.test(name);
  }

  // src/itemIndex.js
  var STORAGE_KEY = "fmp-market-plus:item-index";
  var CACHE_VERSION = 1;
  var DEFAULT_TTL_MS2 = 24 * 60 * 60 * 1e3;
  function createItemIndex({
    flatstats,
    storage = safeLocalStorage(),
    ttlMs = DEFAULT_TTL_MS2,
    now = () => Date.now(),
    log = () => {
    }
  } = {}) {
    let byName = /* @__PURE__ */ Object.create(null);
    let loaded = false;
    function ingest(items) {
      byName = /* @__PURE__ */ Object.create(null);
      let count = 0;
      for (const item of items) {
        if (!item || !item.name) continue;
        byName[item.name] = {
          name: item.name,
          displayName: item.display_name || prettify(item.name),
          imageUrl: item.image_url || null
        };
        count++;
      }
      loaded = count > 0;
    }
    function readCache() {
      if (!storage) return null;
      try {
        const raw = storage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (parsed.version !== CACHE_VERSION) return null;
        if (!Array.isArray(parsed.items)) return null;
        if (!(parsed.expires > now())) return null;
        return parsed.items;
      } catch {
        return null;
      }
    }
    function writeCache(items) {
      if (!storage) return;
      try {
        storage.setItem(
          STORAGE_KEY,
          JSON.stringify({ version: CACHE_VERSION, expires: now() + ttlMs, items })
        );
      } catch {
      }
    }
    return {
      /**
       * Populate the index. Safe to call repeatedly.
       * A failure here degrades the UI to raw snake_case names rather than
       * breaking it, so the error is logged and swallowed.
       */
      async load() {
        const cached = readCache();
        if (cached) {
          ingest(cached);
          return true;
        }
        try {
          const res = await flatstats.getItems();
          ingest(res);
          writeCache(res);
          return true;
        } catch (err) {
          log("item index unavailable, falling back to raw names:", err && err.message);
          return false;
        }
      },
      isLoaded: () => loaded,
      /** Human-readable name, falling back to a de-underscored raw name. */
      displayName(name) {
        return byName[name]?.displayName || prettify(name);
      },
      iconUrl(name) {
        return byName[name]?.imageUrl || (typeof name === "string" ? `https://flatmmo.com/images/items/${name}.png` : null);
      },
      /** Every known item, for the typeahead to rank. */
      all() {
        return Object.values(byName);
      }
    };
  }
  function prettify(name) {
    if (typeof name !== "string" || !name) return "";
    return name.split("_").filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
  }
  function safeLocalStorage() {
    try {
      return typeof localStorage !== "undefined" ? localStorage : null;
    } catch {
      return null;
    }
  }

  // src/ui/styles.js
  var PREFIX = "fmpm";
  var CSS = `
.${PREFIX}-panel {
  margin: 10px 0;
  padding: 8px 10px;
  border: 1px solid #c9c9c9;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.035);
  font-size: 0.85rem;
  line-height: 1.5;
  color: #1f1f1f;
  text-align: left;
}
.${PREFIX}-row { display: flex; justify-content: space-between; gap: 12px; }
.${PREFIX}-row + .${PREFIX}-row { margin-top: 3px; }
.${PREFIX}-label { color: #5c5c5c; }
.${PREFIX}-value { font-variant-numeric: tabular-nums; white-space: nowrap; font-weight: 600; }
.${PREFIX}-good { color: #1a7f37; }
.${PREFIX}-warn { color: #8a6100; }
.${PREFIX}-bad { color: #b42318; }
.${PREFIX}-muted { color: #5c5c5c; font-weight: 400; }

.${PREFIX}-btn {
  display: inline-block;
  padding: 2px 10px;
  margin-left: 6px;
  border: 1px solid #3a3a3a;
  border-radius: 4px;
  background: #333;
  color: #f0f0f0;
  font-size: 0.78rem;
  cursor: pointer;
  user-select: none;
  vertical-align: middle;
}
.${PREFIX}-btn:hover { background: #4a4a4a; }
.${PREFIX}-btn[aria-disabled="true"] { opacity: 0.35; cursor: default; }
.${PREFIX}-btn[aria-disabled="true"]:hover { background: #333; }

.${PREFIX}-heading {
  margin: 8px 0 4px;
  padding-top: 6px;
  border-top: 1px solid #d0d0d0;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: #6a6a6a;
}

.${PREFIX}-problem {
  margin-top: 6px;
  padding: 5px 8px;
  border-left: 3px solid #d9a400;
  background: rgba(217, 164, 0, 0.12);
  color: #6b4d00;
  font-size: 0.8rem;
}

.${PREFIX}-spark { display: block; width: 100%; height: 40px; margin-top: 6px; }
.${PREFIX}-spark-line { fill: none; stroke: #1a7f37; stroke-width: 1.5; }
.${PREFIX}-spark-area { fill: rgba(26, 127, 55, 0.12); stroke: none; }

/* --- Typeahead: sits inside the light posting modal --- */
.${PREFIX}-ta {
  position: fixed;
  z-index: 10060;
  min-width: 240px;
  max-height: 260px;
  overflow-y: auto;
  border: 1px solid #b9b9b9;
  border-radius: 6px;
  background: #fff;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.22);
  text-align: left;
}
.${PREFIX}-ta-row {
  display: flex; align-items: center; gap: 8px;
  padding: 5px 8px; cursor: pointer; font-size: 0.85rem; color: #1f1f1f;
}
.${PREFIX}-ta-row:hover, .${PREFIX}-ta-active { background: #e8f0fe; }
.${PREFIX}-ta-icon { width: 20px; height: 20px; object-fit: contain; flex: none; }
.${PREFIX}-ta-name { flex: 1; }
.${PREFIX}-ta-raw { color: #8a8a8a; font-size: 0.75rem; }

/* --- Market browser: a dark sheet over the game --- */
.${PREFIX}-overlay {
  position: fixed; inset: 0; z-index: 10040;
  display: flex; align-items: center; justify-content: center;
  background: rgba(0, 0, 0, 0.6);
}
.${PREFIX}-sheet {
  width: min(760px, 94vw); max-height: 88vh;
  display: flex; flex-direction: column;
  border: 1px solid #3a3a3a; border-radius: 8px;
  background: #1c1c1c; color: #e6e6e6;
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.55);
}
.${PREFIX}-sheet-head {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 14px; border-bottom: 1px solid #333;
}
.${PREFIX}-sheet-title { flex: 1; font-size: 1.05rem; font-weight: 700; }
.${PREFIX}-sheet-close { cursor: pointer; font-size: 1.4rem; line-height: 1; color: #b9b9b9; }
.${PREFIX}-sheet-close:hover { color: #fff; }
.${PREFIX}-sheet-body { padding: 12px 14px; overflow-y: auto; }
.${PREFIX}-loading { padding: 24px 0; text-align: center; color: #9a9a9a; }

.${PREFIX}-strip { display: flex; flex-wrap: wrap; gap: 14px; margin-bottom: 12px; }
.${PREFIX}-strip-cell {
  flex: 1 1 110px; padding: 7px 10px;
  border: 1px solid #333; border-radius: 6px; background: #232323;
}
.${PREFIX}-strip-label { font-size: 0.72rem; color: #9a9a9a; text-transform: uppercase; }
.${PREFIX}-strip-value { font-size: 1rem; font-weight: 700; font-variant-numeric: tabular-nums; }

.${PREFIX}-chart { margin: 6px 0 14px; }
.${PREFIX}-chart-caption { font-size: 0.75rem; color: #9a9a9a; margin-bottom: 4px; }
.${PREFIX}-sheet .${PREFIX}-spark { height: 70px; }
.${PREFIX}-sheet .${PREFIX}-spark-line { stroke: #8ce99a; }
.${PREFIX}-sheet .${PREFIX}-spark-area { fill: rgba(140, 233, 154, 0.14); }

.${PREFIX}-ladders { display: flex; flex-wrap: wrap; gap: 14px; }
.${PREFIX}-ladder { flex: 1 1 260px; margin-bottom: 14px; }
.${PREFIX}-ladder-title {
  font-size: 0.78rem; text-transform: uppercase; color: #9a9a9a; margin-bottom: 4px;
}
.${PREFIX}-table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
.${PREFIX}-table th {
  text-align: right; padding: 4px 6px; border-bottom: 1px solid #383838;
  color: #9a9a9a; font-weight: 600;
}
.${PREFIX}-table th:first-child, .${PREFIX}-table td:first-child { text-align: left; }
.${PREFIX}-table td {
  text-align: right; padding: 4px 6px;
  border-bottom: 1px solid #2a2a2a; font-variant-numeric: tabular-nums;
}
.${PREFIX}-table td:first-child { display: flex; align-items: center; gap: 7px; }
.${PREFIX}-sheet .${PREFIX}-good { color: #8ce99a; }
.${PREFIX}-sheet .${PREFIX}-bad { color: #ff9b8e; }
.${PREFIX}-sheet .${PREFIX}-muted { color: #8a8a8a; }
.${PREFIX}-row-click { cursor: pointer; }
.${PREFIX}-table-hover tbody tr:hover { background: #262626; }

.${PREFIX}-controls { display: flex; gap: 8px; margin-bottom: 10px; }
.${PREFIX}-filter, .${PREFIX}-sort {
  padding: 5px 8px; border: 1px solid #3d3d3d; border-radius: 5px;
  background: #262626; color: #e6e6e6; font-size: 0.85rem;
}
.${PREFIX}-filter { flex: 1; }
`;
  function ensureStyles(doc = document) {
    const id = `${PREFIX}-styles`;
    if (doc.getElementById(id)) return;
    const style = doc.createElement("style");
    style.id = id;
    style.textContent = CSS;
    doc.head.appendChild(style);
  }

  // src/money.js
  var TAX_THRESHOLD = 100;
  function estimateSellTax(price, quantity) {
    if (!isPositive(price) || !isPositive(quantity)) return 0;
    if (price < TAX_THRESHOLD) return 0;
    return Math.floor(price * quantity / 100);
  }
  function buyOrderCost(price, quantity) {
    if (!isPositive(price) || !isPositive(quantity)) return 0;
    return price * quantity;
  }
  function sellNetProceeds(price, quantity) {
    if (!isPositive(price) || !isPositive(quantity)) return 0;
    return price * quantity - estimateSellTax(price, quantity);
  }
  function maxBuyQuantity(coins, price) {
    if (!isPositive(price) || !isPositive(coins)) return 0;
    return Math.floor(coins / price);
  }
  function maxSellQuantity(bankAmount) {
    if (!isPositive(bankAmount)) return 0;
    return Math.floor(bankAmount);
  }
  function isPositive(n) {
    return typeof n === "number" && Number.isFinite(n) && n > 0;
  }
  function compareToVendor({ price, quantity, vendorPrice }) {
    if (!isPositive(quantity)) return null;
    if (!isPositive(vendorPrice)) return null;
    const vendorTotal = vendorPrice * quantity;
    const marketNet = isPositive(price) ? sellNetProceeds(price, quantity) : null;
    if (marketNet === null) return { vendorTotal, marketNet: null, better: null, ratio: null };
    return {
      vendorTotal,
      marketNet,
      better: marketNet > vendorTotal ? "market" : marketNet < vendorTotal ? "vendor" : "equal",
      ratio: vendorTotal > 0 ? marketNet / vendorTotal : null
    };
  }

  // src/gameNumber.js
  var MULTIPLIERS = { k: 1e3, m: 1e6 };
  function parseGameNumber(str) {
    if (typeof str !== "string") return NaN;
    const s = str.trim().toLowerCase();
    const match = s.match(/^(\d+(\.\d+)?)([kmb])?$/);
    if (!match) return NaN;
    let value = Number.parseFloat(match[1]);
    const suffix = match[3];
    if (suffix) value *= MULTIPLIERS[suffix];
    return value;
  }
  function describeInputProblem(str) {
    if (typeof str !== "string" || str.trim() === "") return null;
    const s = str.trim().toLowerCase();
    if (/^(\d+(\.\d+)?)b$/.test(s)) {
      return 'The game does not understand the "b" suffix and will post NaN. Type the digits out.';
    }
    const value = parseGameNumber(s);
    if (Number.isNaN(value)) {
      if (/[,\s]/.test(s)) return "Separators are not accepted here. Try 10000 or 10k.";
      return "The game cannot read this. Use digits, optionally with a k or m suffix.";
    }
    if (!Number.isInteger(value)) {
      return `This is not a whole number (${value}).`;
    }
    return null;
  }

  // src/valuation.js
  function summarise(detail, period = "7d") {
    if (!detail || typeof detail !== "object") return null;
    const bestBuy = numberOrNull(detail.best_buy);
    const bestSell = numberOrNull(detail.best_sell);
    const allStats = detail.stats && typeof detail.stats === "object" ? detail.stats : {};
    const stats = allStats[period] && typeof allStats[period] === "object" ? allStats[period] : {};
    return {
      period,
      bestBuy,
      bestSell,
      avgPrice: numberOrNull(stats.avg_price),
      volume: numberOrNull(stats.volume),
      unitsSold: numberOrNull(stats.sold),
      spread: bestBuy !== null && bestSell !== null ? bestSell - bestBuy : null
    };
  }
  function priceVerdict({ price, direction, summary }) {
    if (!Number.isFinite(price) || price <= 0 || !summary) {
      return { fills: null, tone: "unknown", headline: "Enter a price", comparison: null };
    }
    if (direction !== "buy" && direction !== "sell") {
      return { fills: null, tone: "unknown", headline: "Pick buy or sell", comparison: null };
    }
    const opposite = direction === "sell" ? summary.bestBuy : summary.bestSell;
    const sameSide = direction === "sell" ? summary.bestSell : summary.bestBuy;
    let fills = null;
    let headline;
    let tone;
    if (opposite === null) {
      fills = false;
      headline = direction === "sell" ? "Nobody is buying this" : "Nobody is selling this";
      tone = "warn";
    } else if (direction === "sell" ? price <= opposite : price >= opposite) {
      fills = true;
      headline = `Fills now against ${formatCoins(opposite)}`;
      tone = "good";
    } else {
      fills = false;
      headline = queuePosition(price, sameSide, direction);
      tone = "neutral";
    }
    return { fills, tone, headline, comparison: compareToAverage(price, summary.avgPrice) };
  }
  function queuePosition(price, sameSide, direction) {
    if (sameSide === null) return "First order on this side";
    if (direction === "sell") {
      if (price < sameSide) return `Undercuts the best sell (${formatCoins(sameSide)})`;
      if (price === sameSide) return `Ties the best sell (${formatCoins(sameSide)})`;
      return `Behind the best sell (${formatCoins(sameSide)})`;
    }
    if (price > sameSide) return `Outbids the best buy (${formatCoins(sameSide)})`;
    if (price === sameSide) return `Ties the best buy (${formatCoins(sameSide)})`;
    return `Behind the best buy (${formatCoins(sameSide)})`;
  }
  function compareToAverage(price, avgPrice) {
    if (!Number.isFinite(price) || price <= 0) return null;
    if (!Number.isFinite(avgPrice) || avgPrice <= 0) return null;
    const pct = (price - avgPrice) / avgPrice * 100;
    return {
      avgPrice,
      percent: pct,
      label: `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}% vs ${formatCoins(Math.round(avgPrice))} avg`
    };
  }
  function formatCoins(n) {
    if (!Number.isFinite(n)) return "?";
    return n.toLocaleString("en-US");
  }
  function numberOrNull(v) {
    return Number.isFinite(v) ? v : null;
  }
  function suggestedPrice({ direction, summary }) {
    if (!summary) return null;
    if (direction === "sell") {
      if (summary.bestSell === null) return null;
      const undercut = summary.bestSell - 1;
      if (summary.bestBuy !== null && undercut <= summary.bestBuy) return summary.bestBuy;
      return undercut >= 1 ? undercut : null;
    }
    if (direction === "buy") {
      if (summary.bestBuy === null) return null;
      const outbid = summary.bestBuy + 1;
      if (summary.bestSell !== null && outbid >= summary.bestSell) return summary.bestSell;
      return outbid;
    }
    return null;
  }

  // src/ui/postingModal.js
  var IDS = {
    amount: "market-select-item-amount",
    price: "market-select-item-price",
    type: "market-select-item-type",
    content: "post-item-content"
  };
  function createPostingModalEnhancer({
    flatstats,
    doc = document,
    log = () => {
    },
    period = "7d",
    showVerdict = true,
    ledger = null,
    getVendorPrice = () => null
  } = {}) {
    let selection = null;
    let summary = null;
    let wired = false;
    function el(id) {
      return doc.getElementById(id);
    }
    function direction() {
      const v = el(IDS.type)?.value;
      return v === "buy" || v === "sell" ? v : null;
    }
    function mount() {
      const content = el(IDS.content);
      const amountInput = el(IDS.amount);
      const priceInput = el(IDS.price);
      if (!content || !amountInput || !priceInput) {
        log("posting modal anchors missing; MAX disabled");
        return false;
      }
      if (!doc.getElementById(`${PREFIX}-max`)) {
        const max = doc.createElement("span");
        max.id = `${PREFIX}-max`;
        max.className = `${PREFIX}-btn`;
        max.textContent = "MAX";
        max.setAttribute("role", "button");
        max.addEventListener("click", onMaxClick);
        amountInput.insertAdjacentElement("afterend", max);
      }
      if (!doc.getElementById(`${PREFIX}-summary`)) {
        const panel = doc.createElement("div");
        panel.id = `${PREFIX}-summary`;
        panel.className = `${PREFIX}-panel`;
        priceInput.closest("div")?.insertAdjacentElement("afterend", panel);
      }
      if (!wired) {
        amountInput.addEventListener("input", update);
        priceInput.addEventListener("input", update);
        wired = true;
      }
      return true;
    }
    function onMaxClick() {
      if (!selection) return;
      const amountInput = el(IDS.amount);
      if (!amountInput) return;
      const price = parseGameNumber(el(IDS.price)?.value ?? "");
      const dir = direction();
      const qty = dir === "buy" ? maxBuyQuantity(selection.coins, price) : maxSellQuantity(selection.bankAmount);
      if (qty <= 0) return;
      amountInput.value = String(qty);
      amountInput.dispatchEvent(new Event("input", { bubbles: true }));
      update();
    }
    function update() {
      const panel = doc.getElementById(`${PREFIX}-summary`);
      if (!panel || !selection) return;
      const dir = direction();
      const rawAmount = el(IDS.amount)?.value ?? "";
      const rawPrice = el(IDS.price)?.value ?? "";
      const amount = parseGameNumber(rawAmount);
      const price = parseGameNumber(rawPrice);
      const maxBtn = doc.getElementById(`${PREFIX}-max`);
      if (maxBtn) {
        const canMax = dir === "buy" ? maxBuyQuantity(selection.coins, price) > 0 : selection.bankAmount > 0;
        maxBtn.setAttribute("aria-disabled", canMax ? "false" : "true");
        maxBtn.title = dir === "buy" && !Number.isFinite(price) ? "Enter a price first \u2014 MAX depends on it" : "Fill in the largest amount you can post";
      }
      panel.innerHTML = "";
      panel.appendChild(
        row(
          dir === "buy" ? "Coins available" : "In bank",
          dir === "buy" ? formatCoins(selection.coins) : `${formatCoins(selection.bankAmount)} \xD7 ${selection.item.replace(/_/g, " ")}`
        )
      );
      if (Number.isFinite(amount) && Number.isFinite(price) && amount > 0 && price > 0) {
        if (dir === "buy") {
          const cost = buyOrderCost(price, amount);
          panel.appendChild(row("Total cost", formatCoins(cost), cost > selection.coins ? "bad" : ""));
          if (cost > selection.coins) {
            panel.appendChild(
              row("Short by", formatCoins(cost - selection.coins), "bad")
            );
          }
        } else {
          const tax = estimateSellTax(price, amount);
          panel.appendChild(row("Gross", formatCoins(price * amount)));
          panel.appendChild(
            row(tax > 0 ? "Tax (1%)" : "Tax (under 100 each)", tax > 0 ? `-${formatCoins(tax)}` : "none", tax > 0 ? "warn" : "muted")
          );
          panel.appendChild(row("You receive", `\u2248 ${formatCoins(sellNetProceeds(price, amount))}`, "good"));
          if (amount > selection.bankAmount) {
            panel.appendChild(row("Over bank stock by", formatCoins(amount - selection.bankAmount), "bad"));
          }
        }
      }
      if (showVerdict && summary && dir) {
        const verdict = priceVerdict({ price, direction: dir, summary });
        if (verdict.tone !== "unknown") {
          panel.appendChild(row("Order", verdict.headline, toneClass(verdict.tone)));
        }
        if (verdict.comparison) {
          panel.appendChild(row("Price", verdict.comparison.label, "muted"));
        }
        const book = summary.bestBuy !== null || summary.bestSell !== null ? `buy ${summary.bestBuy ?? "\u2014"} / sell ${summary.bestSell ?? "\u2014"}` : null;
        if (book) panel.appendChild(row("Best on book", book, "muted"));
      }
      if (summary && dir) {
        const suggestion = suggestedPrice({ direction: dir, summary });
        if (suggestion !== null && suggestion !== price) {
          panel.appendChild(suggestionRow(suggestion, dir));
        }
      }
      if (dir === "sell") {
        const vendor = compareToVendor({
          price,
          quantity: Number.isFinite(amount) && amount > 0 ? amount : 1,
          vendorPrice: getVendorPrice(selection.item)
        });
        if (vendor && vendor.better) {
          panel.appendChild(
            row(
              "Vendor would pay",
              formatCoins(vendor.vendorTotal),
              vendor.better === "vendor" ? "warn" : "muted"
            )
          );
          if (vendor.better === "vendor") {
            panel.appendChild(
              problemLine("A vendor pays more than this listing would net you after tax.")
            );
          }
        }
      }
      if (ledger) panel.append(...historyRows(selection.item, summary));
      for (const [field, raw] of [
        ["Amount", rawAmount],
        ["Price", rawPrice]
      ]) {
        const problem = describeInputProblem(raw);
        if (problem) panel.appendChild(problemLine(`${field}: ${problem}`));
      }
    }
    function historyRows(itemName, marketSummary) {
      const stats = ledger.summaryFor(itemName);
      if (!stats || stats.trades === 0) return [];
      const out = [heading("Your history")];
      if (stats.soldUnits > 0) {
        out.push(row("Sold all time", `${formatCoins(stats.soldUnits)} for ${formatCoins(stats.soldNet)}`));
        const avg = Math.round(stats.avgSalePrice);
        const marketNow = marketSummary ? marketSummary.bestSell : null;
        out.push(
          row(
            "Your average",
            marketNow !== null ? `${formatCoins(avg)} (market ${formatCoins(marketNow)})` : formatCoins(avg),
            marketNow !== null && marketNow > avg ? "good" : "muted"
          )
        );
      }
      if (stats.costBasisKnown) {
        out.push(row("Avg cost", formatCoins(Math.round(stats.avgCostBasis)), "muted"));
        out.push(
          row(
            "Realised P/L",
            `${stats.realised >= 0 ? "+" : ""}${formatCoins(Math.round(stats.realised))}`,
            stats.realised >= 0 ? "good" : "bad"
          )
        );
      } else if (stats.soldUnits > 0) {
        out.push(row("Realised P/L", "no purchase record", "muted"));
      }
      for (const t of ledger.tradesFor(itemName).slice(0, 3)) {
        out.push(
          row(
            `${t.direction === "sell" ? "Sold" : "Bought"} ${String(t.completedAt).slice(0, 10)}`,
            `${formatCoins(t.amount)} @ ${formatCoins(t.price)}`,
            "muted"
          )
        );
      }
      return out;
    }
    function heading(text) {
      const d = doc.createElement("div");
      d.className = `${PREFIX}-heading`;
      d.textContent = text;
      return d;
    }
    function suggestionRow(value, dir) {
      const wrap = doc.createElement("div");
      wrap.className = `${PREFIX}-row`;
      const l = doc.createElement("span");
      l.className = `${PREFIX}-label`;
      l.textContent = dir === "sell" ? "Undercut to" : "Outbid at";
      const chip = doc.createElement("span");
      chip.className = `${PREFIX}-btn`;
      chip.textContent = formatCoins(value);
      chip.setAttribute("role", "button");
      chip.addEventListener("click", () => {
        const priceInput = el(IDS.price);
        if (!priceInput) return;
        priceInput.value = String(value);
        priceInput.dispatchEvent(new Event("input", { bubbles: true }));
        update();
      });
      wrap.append(l, chip);
      return wrap;
    }
    function row(label, value, tone = "") {
      const wrap = doc.createElement("div");
      wrap.className = `${PREFIX}-row`;
      const l = doc.createElement("span");
      l.className = `${PREFIX}-label`;
      l.textContent = label;
      const v = doc.createElement("span");
      v.className = `${PREFIX}-value${tone ? ` ${PREFIX}-${tone}` : ""}`;
      v.textContent = value;
      wrap.append(l, v);
      return wrap;
    }
    function problemLine(text) {
      const d = doc.createElement("div");
      d.className = `${PREFIX}-problem`;
      d.textContent = text;
      return d;
    }
    function toneClass(tone) {
      return tone === "good" ? "good" : tone === "warn" ? "warn" : "muted";
    }
    return {
      /**
       * The player picked an item; the server has told us their bank stock and
       * coins. Render immediately from those, then refine once flatstats answers.
       */
      onItemSelected(next) {
        selection = next;
        summary = null;
        if (!mount()) return;
        update();
        if (!showVerdict) return;
        flatstats.getItem(next.item, period).then((detail) => {
          if (selection && selection.item === next.item) {
            summary = summarise(detail, period);
            update();
          }
        }).catch((err) => {
          log("flatstats lookup failed for", next.item, err && err.message);
        });
      },
      /** Exposed for the plugin to force a redraw. */
      refresh: update
    };
  }

  // src/chart.js
  function buildSparkline(series, { width = 280, height = 40, padding = 2 } = {}) {
    const points = (Array.isArray(series) ? series : []).filter(
      (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y)
    );
    if (points.length < 2) return null;
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const spanX = maxX - minX || 1;
    const spanY = maxY - minY;
    const innerH = height - padding * 2;
    const projected = points.map((p) => ({
      px: padding + (p.x - minX) / spanX * (width - padding * 2),
      py: spanY === 0 ? height / 2 : padding + innerH - (p.y - minY) / spanY * innerH
    }));
    const line = projected.map((p, i) => `${i === 0 ? "M" : "L"}${round(p.px)},${round(p.py)}`).join(" ");
    const area = `${line} L${round(projected[projected.length - 1].px)},${height - padding} L${round(projected[0].px)},${height - padding} Z`;
    return { line, area, minY, maxY, first: ys[0], last: ys[ys.length - 1], count: points.length };
  }
  function toEpoch(value) {
    if (typeof value !== "string" || !value) return null;
    const normalised = value.includes("T") ? value : value.replace(" ", "T") + "Z";
    const ms = Date.parse(normalised);
    return Number.isNaN(ms) ? null : ms;
  }
  function round(n) {
    return Math.round(n * 10) / 10;
  }

  // src/search.js
  var SCORE = {
    EXACT: 1e3,
    PREFIX: 800,
    WORD_PREFIX: 600,
    SUBSTRING: 400,
    INITIALS: 300,
    SUBSEQUENCE: 100
  };
  function scoreItem(query, item) {
    const q = normalise(query);
    if (!q) return 0;
    const display = normalise(item.displayName || item.name);
    const raw = normalise(item.name);
    let best = 0;
    for (const haystack of [display, raw]) {
      if (!haystack) continue;
      if (haystack === q) best = Math.max(best, SCORE.EXACT);
      else if (haystack.startsWith(q)) best = Math.max(best, SCORE.PREFIX);
      else if (wordStarts(haystack).some((w) => w.startsWith(q)))
        best = Math.max(best, SCORE.WORD_PREFIX);
      else if (haystack.includes(q)) best = Math.max(best, SCORE.SUBSTRING);
      else if (initials(haystack).startsWith(q)) best = Math.max(best, SCORE.INITIALS);
      else if (isSubsequence(q, haystack)) best = Math.max(best, SCORE.SUBSEQUENCE);
    }
    if (best === 0) return 0;
    return best + Math.max(0, 99 - display.length);
  }
  function searchItems(query, items, { limit = 12, allowed = null } = {}) {
    if (!Array.isArray(items)) return [];
    const pool = allowed ? items.filter((i) => allowed.has(i.name)) : items;
    if (!normalise(query)) {
      return pool.slice(0, limit).map((item) => ({ item, score: 0 }));
    }
    const scored = [];
    for (const item of pool) {
      const score = scoreItem(query, item);
      if (score > 0) scored.push({ item, score });
    }
    scored.sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name));
    return scored.slice(0, limit);
  }
  function normalise(s) {
    if (typeof s !== "string") return "";
    return s.toLowerCase().replace(/_/g, " ").replace(/\s+/g, " ").trim();
  }
  function wordStarts(s) {
    return s.split(/[\s_]+/).filter(Boolean);
  }
  function initials(s) {
    return wordStarts(s).map((w) => w[0]).join("");
  }
  function isSubsequence(needle, haystack) {
    let i = 0;
    for (const ch of haystack) {
      if (ch === needle[i]) i++;
      if (i === needle.length) return true;
    }
    return needle.length === 0;
  }

  // src/ui/browser.js
  function createMarketBrowser({
    flatstats,
    itemIndex,
    ledger = null,
    doc = document,
    log = () => {
    }
  }) {
    let overlay = null;
    let overviewCache = null;
    let sort = "hot";
    function close() {
      if (overlay) overlay.remove();
      overlay = null;
      doc.removeEventListener("keydown", onKey);
    }
    function ensureOverlay() {
      if (overlay && overlay.isConnected) return overlay;
      overlay = doc.createElement("div");
      overlay.className = `${PREFIX}-overlay`;
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) close();
      });
      doc.body.appendChild(overlay);
      doc.addEventListener("keydown", onKey);
      return overlay;
    }
    function onKey(e) {
      if (e.key === "Escape" && overlay) close();
    }
    function shell(title, { onBack } = {}) {
      const o = ensureOverlay();
      o.innerHTML = "";
      const panel = doc.createElement("div");
      panel.className = `${PREFIX}-sheet`;
      const head = doc.createElement("div");
      head.className = `${PREFIX}-sheet-head`;
      if (onBack) {
        const back = doc.createElement("span");
        back.className = `${PREFIX}-btn`;
        back.textContent = "\u2039 All items";
        back.addEventListener("click", onBack);
        head.appendChild(back);
      }
      const h = doc.createElement("div");
      h.className = `${PREFIX}-sheet-title`;
      h.textContent = title;
      head.appendChild(h);
      const x = doc.createElement("span");
      x.className = `${PREFIX}-sheet-close`;
      x.textContent = "\xD7";
      x.addEventListener("click", close);
      head.appendChild(x);
      const body = doc.createElement("div");
      body.className = `${PREFIX}-sheet-body`;
      panel.append(head, body);
      o.appendChild(panel);
      return body;
    }
    function loading(body) {
      const d = doc.createElement("div");
      d.className = `${PREFIX}-loading`;
      d.textContent = "Loading\u2026";
      body.appendChild(d);
    }
    function failure(body, err) {
      const d = doc.createElement("div");
      d.className = `${PREFIX}-loading`;
      d.textContent = `Could not reach flatstats: ${err && err.message ? err.message : "unknown error"}`;
      body.appendChild(d);
    }
    async function openItem(name) {
      const body = shell(itemIndex.displayName(name), {
        onBack: overviewCache ? () => openAll() : null
      });
      loading(body);
      try {
        const detail = await flatstats.getItem(name, "7d");
        body.innerHTML = "";
        renderItem(body, name, detail);
      } catch (err) {
        body.innerHTML = "";
        failure(body, err);
        log("item view failed", name, err && err.message);
      }
    }
    function renderItem(body, name, detail) {
      const stats7 = detail?.stats?.["7d"] || {};
      const stats24 = detail?.stats?.["24h"] || {};
      body.appendChild(
        statsStrip([
          ["Best buy", detail.best_buy != null ? formatCoins(detail.best_buy) : "\u2014"],
          ["Best sell", detail.best_sell != null ? formatCoins(detail.best_sell) : "\u2014"],
          [
            "Spread",
            detail.best_buy != null && detail.best_sell != null ? formatCoins(detail.best_sell - detail.best_buy) : "\u2014"
          ],
          ["7d avg", stats7.avg_price ? formatCoins(Math.round(stats7.avg_price)) : "\u2014"],
          ["24h volume", formatCoins(stats24.volume || 0)]
        ])
      );
      const spark = priceSeries(detail);
      if (spark) body.appendChild(spark);
      const ladders = doc.createElement("div");
      ladders.className = `${PREFIX}-ladders`;
      ladders.append(
        ladder("Buy orders", detail?.book?.buys || [], "buy"),
        ladder("Sell orders", detail?.book?.sells || [], "sell")
      );
      body.appendChild(ladders);
      const trades = Array.isArray(detail.trades) ? detail.trades.slice().reverse() : [];
      body.appendChild(tradeTable(trades));
      if (ledger) {
        const mine = ledger.tradesFor(name);
        if (mine.length > 0) body.appendChild(myTradesTable(mine, ledger.summaryFor(name)));
      }
    }
    function myTradesTable(mine, stats) {
      const wrap = doc.createElement("div");
      wrap.className = `${PREFIX}-ladder`;
      const h = doc.createElement("div");
      h.className = `${PREFIX}-ladder-title`;
      h.textContent = "Your trades";
      wrap.appendChild(h);
      wrap.appendChild(
        statsStrip(
          [
            ["Units sold", formatCoins(stats.soldUnits)],
            ["Net received", formatCoins(stats.soldNet)],
            ["Your average", stats.avgSalePrice ? formatCoins(Math.round(stats.avgSalePrice)) : "\u2014"],
            [
              "Realised P/L",
              // Without purchase records there is no cost basis, and reporting
              // revenue as profit would overstate it by whatever the goods cost.
              stats.costBasisKnown ? formatCoins(Math.round(stats.realised)) : "unknown"
            ]
          ].filter(Boolean)
        )
      );
      const table = doc.createElement("table");
      table.className = `${PREFIX}-table`;
      table.innerHTML = "<thead><tr><th>When</th><th>Side</th><th>Quantity</th><th>Price</th></tr></thead>";
      const tbody = doc.createElement("tbody");
      for (const t of mine.slice(0, 25)) {
        const tr = doc.createElement("tr");
        tr.innerHTML = `<td class="${PREFIX}-muted">${escapeHtml(String(t.completedAt).slice(0, 16))}</td><td class="${PREFIX}-${t.direction === "sell" ? "bad" : "good"}">${t.direction}</td><td>${formatCoins(t.amount)}</td><td>${formatCoins(t.price)}</td>`;
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      wrap.appendChild(table);
      return wrap;
    }
    function priceSeries(detail) {
      const fromBook = (detail.book_history || []).map((row) => ({ x: toEpoch(row.sampled_at), y: numberOrNull2(row.best_sell) })).filter((p) => p.x !== null);
      const fromTrades = (detail.trades || []).map((row) => ({ x: toEpoch(row.completed_on), y: numberOrNull2(row.price) })).filter((p) => p.x !== null);
      const series = fromBook.filter((p) => p.y !== null).length >= 2 ? fromBook : fromTrades;
      const geom = buildSparkline(series, { width: 560, height: 70, padding: 4 });
      if (!geom) return null;
      const wrap = doc.createElement("div");
      wrap.className = `${PREFIX}-chart`;
      const caption = doc.createElement("div");
      caption.className = `${PREFIX}-chart-caption`;
      caption.textContent = `${series === fromBook ? "Best sell" : "Traded price"}, 7 days \xB7 low ${formatCoins(geom.minY)} \xB7 high ${formatCoins(geom.maxY)}`;
      const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 560 70");
      svg.setAttribute("preserveAspectRatio", "none");
      svg.setAttribute("class", `${PREFIX}-spark`);
      const area = doc.createElementNS("http://www.w3.org/2000/svg", "path");
      area.setAttribute("d", geom.area);
      area.setAttribute("class", `${PREFIX}-spark-area`);
      const line = doc.createElementNS("http://www.w3.org/2000/svg", "path");
      line.setAttribute("d", geom.line);
      line.setAttribute("class", `${PREFIX}-spark-line`);
      svg.append(area, line);
      wrap.append(caption, svg);
      return wrap;
    }
    function ladder(title, rows, side) {
      const wrap = doc.createElement("div");
      wrap.className = `${PREFIX}-ladder`;
      const h = doc.createElement("div");
      h.className = `${PREFIX}-ladder-title`;
      h.textContent = title;
      wrap.appendChild(h);
      if (rows.length === 0) {
        const empty = doc.createElement("div");
        empty.className = `${PREFIX}-muted`;
        empty.textContent = "No orders";
        wrap.appendChild(empty);
        return wrap;
      }
      const table = doc.createElement("table");
      table.className = `${PREFIX}-table`;
      table.innerHTML = "<thead><tr><th>Price</th><th>Quantity</th><th>Cumulative</th></tr></thead>";
      const tbody = doc.createElement("tbody");
      let cumulative = 0;
      for (const row of rows) {
        cumulative += row.quantity;
        const tr = doc.createElement("tr");
        tr.innerHTML = `<td class="${PREFIX}-${side === "buy" ? "good" : "bad"}">${formatCoins(row.price)}</td><td>${formatCoins(row.quantity)}</td><td class="${PREFIX}-muted">${formatCoins(cumulative)}</td>`;
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      wrap.appendChild(table);
      return wrap;
    }
    function tradeTable(trades) {
      const wrap = doc.createElement("div");
      wrap.className = `${PREFIX}-ladder`;
      const h = doc.createElement("div");
      h.className = `${PREFIX}-ladder-title`;
      h.textContent = "Recent trades";
      wrap.appendChild(h);
      if (trades.length === 0) {
        const empty = doc.createElement("div");
        empty.className = `${PREFIX}-muted`;
        empty.textContent = "No trades in the last 7 days";
        wrap.appendChild(empty);
        return wrap;
      }
      const table = doc.createElement("table");
      table.className = `${PREFIX}-table`;
      table.innerHTML = "<thead><tr><th>When</th><th>Quantity</th><th>Price</th></tr></thead>";
      const tbody = doc.createElement("tbody");
      for (const t of trades.slice(0, 15)) {
        const tr = doc.createElement("tr");
        tr.innerHTML = `<td class="${PREFIX}-muted">${(t.completed_on || "").slice(0, 16)}</td><td>${formatCoins(t.amount_sold)}</td><td>${formatCoins(t.price)}</td>`;
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      wrap.appendChild(table);
      return wrap;
    }
    async function openAll() {
      const body = shell("Global Market");
      loading(body);
      try {
        const data = overviewCache || await flatstats.getOverview(sort);
        overviewCache = data;
        body.innerHTML = "";
        renderAll(body, data);
      } catch (err) {
        body.innerHTML = "";
        failure(body, err);
        log("overview failed", err && err.message);
      }
    }
    function renderAll(body, data) {
      const s = data.summary || {};
      body.appendChild(
        statsStrip([
          ["Items trading", formatCoins(s.active_items || 0)],
          ["Open buy orders", formatCoins(s.buy_orders || 0)],
          ["Buy escrow", formatCoins(s.buy_escrow || 0)],
          ["24h volume", formatCoins(s.volume_24h || 0)],
          ["24h fills", formatCoins(s.orders_completed_24h || 0)]
        ])
      );
      const controls = doc.createElement("div");
      controls.className = `${PREFIX}-controls`;
      const filter = doc.createElement("input");
      filter.className = `${PREFIX}-filter`;
      filter.placeholder = "Filter items\u2026";
      const sortSel = doc.createElement("select");
      sortSel.className = `${PREFIX}-sort`;
      for (const [value, label] of [
        ["hot", "Hottest"],
        ["volume", "24h volume"],
        ["margin", "Margin"],
        ["roi", "ROI"],
        ["name", "Name"]
      ]) {
        const opt = doc.createElement("option");
        opt.value = value;
        opt.textContent = label;
        if (value === sort) opt.selected = true;
        sortSel.appendChild(opt);
      }
      sortSel.addEventListener("change", async () => {
        sort = sortSel.value;
        overviewCache = null;
        await openAll();
      });
      controls.append(filter, sortSel);
      body.appendChild(controls);
      const host = doc.createElement("div");
      body.appendChild(host);
      const draw = () => {
        const query = filter.value.trim();
        const pool = (data.items || []).map((i) => ({
          ...i,
          name: i.item_name,
          displayName: i.display_name || i.item_name
        }));
        const rows = query ? searchItems(query, pool, { limit: 200 }).map((r) => r.item) : pool.slice(0, 200);
        host.innerHTML = "";
        host.appendChild(overviewTable(rows));
      };
      filter.addEventListener("input", draw);
      draw();
      filter.focus();
    }
    function overviewTable(rows) {
      const table = doc.createElement("table");
      table.className = `${PREFIX}-table ${PREFIX}-table-hover`;
      table.innerHTML = "<thead><tr><th>Item</th><th>Best buy</th><th>Best sell</th><th>Margin</th><th>24h volume</th></tr></thead>";
      const tbody = doc.createElement("tbody");
      if (rows.length === 0) {
        const tr = doc.createElement("tr");
        tr.innerHTML = `<td colspan="5" class="${PREFIX}-muted">Nothing matches</td>`;
        tbody.appendChild(tr);
      }
      for (const row of rows) {
        const tr = doc.createElement("tr");
        tr.className = `${PREFIX}-row-click`;
        tr.innerHTML = `<td><img class="${PREFIX}-ta-icon" src="${escapeHtml(itemIndex.iconUrl(row.name))}" alt=""><span>${escapeHtml(row.displayName)}</span></td><td class="${PREFIX}-good">${row.buy_price != null ? formatCoins(row.buy_price) : "\u2014"}</td><td class="${PREFIX}-bad">${row.sell_price != null ? formatCoins(row.sell_price) : "\u2014"}</td><td>${row.margin != null ? formatCoins(row.margin) : "\u2014"}</td><td>${formatCoins(row.volume_24h || 0)}</td>`;
        tr.addEventListener("click", () => openItem(row.name));
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      return table;
    }
    function statsStrip(pairs) {
      const strip = doc.createElement("div");
      strip.className = `${PREFIX}-strip`;
      for (const [label, value] of pairs) {
        const cell = doc.createElement("div");
        cell.className = `${PREFIX}-strip-cell`;
        const l = doc.createElement("div");
        l.className = `${PREFIX}-strip-label`;
        l.textContent = label;
        const v = doc.createElement("div");
        v.className = `${PREFIX}-strip-value`;
        v.textContent = value;
        cell.append(l, v);
        strip.appendChild(cell);
      }
      return strip;
    }
    return {
      /** Render whatever a parsed market URL pointed at. */
      open(target) {
        if (!target) return;
        if (target.kind === "all") openAll();
        else openItem(target.item);
      },
      close
    };
  }
  function numberOrNull2(v) {
    return Number.isFinite(v) ? v : null;
  }
  function escapeHtml(s) {
    return String(s).replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
    );
  }

  // src/ui/typeahead.js
  function createTypeahead({ input, itemIndex, doc = document, maxResults = 8 }) {
    if (!input) return null;
    let box = null;
    let results = [];
    let active = -1;
    const originalList = input.getAttribute("list");
    input.removeAttribute("list");
    input.setAttribute("autocomplete", "off");
    function allowedNames() {
      const list = originalList ? doc.getElementById(originalList) : null;
      if (!list || !list.options || list.options.length === 0) return null;
      const names = /* @__PURE__ */ new Set();
      for (const opt of list.options) names.add(opt.value);
      return names;
    }
    function ensureBox() {
      if (box && box.isConnected) return box;
      box = doc.createElement("div");
      box.className = `${PREFIX}-ta`;
      box.setAttribute("role", "listbox");
      doc.body.appendChild(box);
      positionBox();
      return box;
    }
    function positionBox() {
      if (!box) return;
      const r = input.getBoundingClientRect();
      const viewportH = doc.documentElement.clientHeight;
      const spaceBelow = viewportH - r.bottom;
      box.style.left = `${r.left}px`;
      box.style.width = `${r.width}px`;
      if (spaceBelow < 160 && r.top > spaceBelow) {
        box.style.top = "auto";
        box.style.bottom = `${viewportH - r.top + 2}px`;
        box.style.maxHeight = `${Math.max(80, r.top - 8)}px`;
      } else {
        box.style.bottom = "auto";
        box.style.top = `${r.bottom + 2}px`;
        box.style.maxHeight = `${Math.max(80, spaceBelow - 8)}px`;
      }
    }
    function close() {
      if (box) box.remove();
      box = null;
      results = [];
      active = -1;
      window.removeEventListener("scroll", positionBox, true);
      window.removeEventListener("resize", positionBox);
    }
    function choose(index) {
      const chosen = results[index];
      if (!chosen) return;
      input.value = chosen.item.name;
      close();
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    function render() {
      const el = ensureBox();
      el.innerHTML = "";
      if (results.length === 0) {
        close();
        return;
      }
      window.addEventListener("scroll", positionBox, true);
      window.addEventListener("resize", positionBox);
      results.forEach(({ item }, i) => {
        const row = doc.createElement("div");
        row.className = `${PREFIX}-ta-row${i === active ? ` ${PREFIX}-ta-active` : ""}`;
        row.setAttribute("role", "option");
        const icon = doc.createElement("img");
        icon.className = `${PREFIX}-ta-icon`;
        icon.src = itemIndex.iconUrl(item.name);
        icon.alt = "";
        icon.addEventListener("error", () => {
          icon.style.visibility = "hidden";
        });
        const label = doc.createElement("span");
        label.className = `${PREFIX}-ta-name`;
        label.textContent = item.displayName;
        const raw = doc.createElement("span");
        raw.className = `${PREFIX}-ta-raw`;
        raw.textContent = item.name;
        row.append(icon, label, raw);
        row.addEventListener("mousedown", (e) => {
          e.preventDefault();
          choose(i);
        });
        el.appendChild(row);
      });
      positionBox();
    }
    function refresh() {
      const query = input.value.trim();
      if (!query) {
        close();
        return;
      }
      const allowed = allowedNames();
      if (allowed && allowed.has(query)) {
        close();
        return;
      }
      results = searchItems(query, itemIndex.all(), { limit: maxResults, allowed });
      active = results.length > 0 ? 0 : -1;
      render();
    }
    function onKeyDown(e) {
      if (results.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        active = (active + 1) % results.length;
        render();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        active = (active - 1 + results.length) % results.length;
        render();
      } else if (e.key === "Enter") {
        e.preventDefault();
        choose(active);
      } else if (e.key === "Escape") {
        close();
      }
    }
    input.addEventListener("input", refresh);
    input.addEventListener("keydown", onKeyDown);
    input.addEventListener("blur", () => setTimeout(close, 120));
    return {
      close,
      /** Restore the game's native control. */
      destroy() {
        close();
        input.removeEventListener("input", refresh);
        input.removeEventListener("keydown", onKeyDown);
        if (originalList) input.setAttribute("list", originalList);
      }
    };
  }

  // src/marketUrl.js
  var LISTING_PATTERN = /^https?:\/\/market\.flatmmo\.com\/market\/listing\/([a-z0-9_]+)\/view\/?/i;
  function parseMarketUrl(url) {
    if (typeof url !== "string") return null;
    const match = url.match(LISTING_PATTERN);
    if (!match) return null;
    const name = match[1].toLowerCase();
    return name === "all" ? { kind: "all" } : { kind: "item", item: name };
  }

  // src/ui/intercept.js
  function installMarketInterception({ target = window, doc = document, onOpen }) {
    const originalOpen = target.open;
    target.open = function patchedOpen(url, ...rest) {
      const parsed = parseMarketUrl(typeof url === "string" ? url : "");
      if (parsed) {
        onOpen(parsed);
        return null;
      }
      return originalOpen.apply(this, [url, ...rest]);
    };
    function onClick(event) {
      const anchor = event.target && event.target.closest ? event.target.closest("a[href]") : null;
      if (!anchor) return;
      const parsed = parseMarketUrl(anchor.getAttribute("href"));
      if (!parsed) return;
      event.preventDefault();
      event.stopPropagation();
      onOpen(parsed);
    }
    doc.addEventListener("click", onClick, true);
    return {
      uninstall() {
        target.open = originalOpen;
        doc.removeEventListener("click", onClick, true);
      }
    };
  }

  // src/protocol.js
  var MARKET_COMMANDS = {
    OPEN: "OPEN_MARKET_UI",
    ITEM_SELECTED: "CHANGED_MARKET_ITEM_POSTING_UI_SELECT",
    POSTINGS: "REFRESH_MARKET_UI_POSTINGS",
    HISTORY: "REFRESH_MARKET_UI_HISTORY",
    STATS: "REFRESH_MARKET_UI_SPENDING_STATS",
    LOADING: "REFRESH_MARKET_UI_POSTINGS_LOADING_SCREEN"
  };
  function parseFrame(raw) {
    if (typeof raw !== "string") return null;
    const split = raw.indexOf("=");
    if (split === -1) return null;
    const command = raw.slice(0, split);
    if (!command) return null;
    const rest = raw.slice(split + 1);
    return { command, values: rest === "" ? [] : rest.split("~") };
  }
  function parseItemSelected(values) {
    if (!Array.isArray(values) || values.length < 3) return null;
    const item = values[0];
    const bankAmount = Number.parseInt(values[1], 10);
    const coins = Number.parseInt(values[2], 10);
    if (!item || Number.isNaN(bankAmount) || Number.isNaN(coins)) return null;
    return { item, bankAmount, coins };
  }
  var HISTORY_FIELDS = ["itemName", "price", "amount", "tax", "direction", "completedAt"];
  function parseHistory(values) {
    if (!Array.isArray(values) || values.length === 0) return [];
    if (values[0] === "none") return [];
    const out = [];
    const size = HISTORY_FIELDS.length;
    for (let i = 0; i + size <= values.length; i += size) {
      const entry = {};
      for (let f = 0; f < size; f++) entry[HISTORY_FIELDS[f]] = values[i + f];
      entry.price = Number.parseInt(entry.price, 10);
      entry.amount = Number.parseInt(entry.amount, 10);
      entry.tax = Number.parseInt(entry.tax, 10) || 0;
      if (!entry.itemName || Number.isNaN(entry.price) || Number.isNaN(entry.amount)) continue;
      if (entry.direction !== "buy" && entry.direction !== "sell") continue;
      out.push(entry);
    }
    return out;
  }
  function historyKey(entry) {
    return [entry.itemName, entry.direction, entry.price, entry.completedAt].join("|");
  }

  // src/ledger.js
  var STORAGE_KEY2 = "fmp-market-plus:ledger";
  var CACHE_VERSION2 = 1;
  function createLedger({ storage = safeLocalStorage2(), log = () => {
  } } = {}) {
    let entries = /* @__PURE__ */ Object.create(null);
    function load() {
      if (!storage) return;
      try {
        const raw = storage.getItem(STORAGE_KEY2);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (parsed.version !== CACHE_VERSION2 || !Array.isArray(parsed.entries)) return;
        for (const e of parsed.entries) {
          const key = historyKey(e);
          if (supersedes(e, entries[key])) entries[key] = e;
        }
      } catch (err) {
        log("ledger unreadable, starting fresh:", err && err.message);
      }
    }
    function persist() {
      if (!storage) return;
      try {
        storage.setItem(
          STORAGE_KEY2,
          JSON.stringify({ version: CACHE_VERSION2, entries: Object.values(entries) })
        );
      } catch (err) {
        log("could not persist ledger:", err && err.message);
      }
    }
    load();
    return {
      /**
       * Merge a batch of parsed history entries. Returns how many changed.
       *
       * Entries recovered from rendered markup carry `provisional: true` because
       * that source has no tax and only a derived unit price. An authoritative
       * frame therefore replaces a provisional entry for the same transaction,
       * while a provisional entry never overwrites real data.
       */
      record(batch) {
        if (!Array.isArray(batch) || batch.length === 0) return 0;
        let changed = 0;
        for (const entry of batch) {
          const key = historyKey(entry);
          const existing = entries[key];
          if (!existing || supersedes(entry, existing)) {
            entries[key] = entry;
            changed++;
          }
        }
        if (changed > 0) persist();
        return changed;
      },
      /** Every recorded transaction for one item, newest first. */
      tradesFor(itemName) {
        return Object.values(entries).filter((e) => e.itemName === itemName).sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)));
      },
      summaryFor(itemName) {
        return summarise2(this.tradesFor(itemName));
      },
      size() {
        return Object.keys(entries).length;
      },
      /** Drop everything. */
      clear() {
        entries = /* @__PURE__ */ Object.create(null);
        persist();
      }
    };
  }
  function supersedes(next, current) {
    if (!current) return true;
    if (current.provisional && !next.provisional) return true;
    if (!current.provisional && next.provisional) return false;
    return next.amount > current.amount;
  }
  function summarise2(trades) {
    let soldUnits = 0;
    let soldGross = 0;
    let soldTax = 0;
    let boughtUnits = 0;
    let boughtSpend = 0;
    for (const t of trades) {
      if (t.direction === "sell") {
        soldUnits += t.amount;
        soldGross += t.amount * t.price;
        soldTax += t.tax || 0;
      } else if (t.direction === "buy") {
        boughtUnits += t.amount;
        boughtSpend += t.amount * t.price;
      }
    }
    const avgSalePrice = soldUnits > 0 ? soldGross / soldUnits : null;
    const avgCostBasis = boughtUnits > 0 ? boughtSpend / boughtUnits : null;
    const costBasisKnown = boughtUnits > 0;
    const matchedUnits = costBasisKnown ? Math.min(soldUnits, boughtUnits) : 0;
    const realised = costBasisKnown && matchedUnits > 0 ? matchedUnits * (avgSalePrice - avgCostBasis) - soldTax * matchedUnits / (soldUnits || 1) : null;
    return {
      trades: trades.length,
      soldUnits,
      soldGross,
      soldTax,
      soldNet: soldGross - soldTax,
      avgSalePrice,
      boughtUnits,
      boughtSpend,
      avgCostBasis,
      costBasisKnown,
      matchedUnits,
      realised
    };
  }
  function safeLocalStorage2() {
    try {
      return typeof localStorage !== "undefined" ? localStorage : null;
    } catch {
      return null;
    }
  }

  // src/domHistory.js
  function parseHistoryLine(itemName, text) {
    if (!itemName || typeof text !== "string") return null;
    const amountMatch = text.match(/^\s*([\d,]+)\s/);
    const actionMatch = text.match(/\s(sold|bought)\s+for\s+([\d,]+)\s+coins/i);
    const dateMatch = text.match(/(\d{4}-\d{2}-\d{2}(?:[ T][\d:.]+)?)\s*$/);
    if (!amountMatch || !actionMatch) return null;
    const amount = toInt(amountMatch[1]);
    const total = toInt(actionMatch[2]);
    if (!amount || amount <= 0 || !Number.isFinite(total)) return null;
    const price = Math.round(total / amount);
    return {
      itemName,
      price,
      amount,
      tax: 0,
      direction: actionMatch[1].toLowerCase() === "bought" ? "buy" : "sell",
      completedAt: dateMatch ? dateMatch[1] : "",
      provisional: true
    };
  }
  function readRenderedHistory(doc = document) {
    const rows = doc.querySelectorAll("#global-market-history .market-ui-posting-history");
    const out = [];
    for (const row of rows) {
      const src = row.querySelector("img")?.getAttribute("src") || "";
      const itemName = src.split("/").pop()?.replace(/\.png$/i, "") || "";
      const entry = parseHistoryLine(itemName, row.textContent.replace(/\s+/g, " ").trim());
      if (entry) out.push(entry);
    }
    return out;
  }
  function toInt(s) {
    return Number.parseInt(String(s).replace(/,/g, ""), 10);
  }

  // src/index.js
  var PLUGIN_ID = "marketplus";
  function definePlugin({ FlatMMOPlusPlugin, FlatMMOPlus, about }) {
    class MarketPlusPlugin extends FlatMMOPlusPlugin {
      constructor() {
        super(PLUGIN_ID, {
          about,
          config: [
            { id: "labelPosting", type: "label", label: "Posting modal:" },
            {
              id: "enableMax",
              label: "Show MAX button and live totals",
              type: "boolean",
              default: true
            },
            {
              id: "enableVerdict",
              label: "Compare prices against flatstats history",
              type: "boolean",
              default: true
            },
            {
              id: "statsPeriod",
              label: "History window for price comparison",
              type: "select",
              options: [
                { value: "24h", label: "Last 24 hours" },
                { value: "7d", label: "Last 7 days" }
              ],
              default: "7d"
            },
            { id: "labelBrowser", type: "label", label: "Market browser:" },
            {
              id: "enableBrowser",
              label: "Open the order book in game instead of a new tab",
              type: "boolean",
              default: true
            },
            {
              id: "enableTypeahead",
              label: "Replace the item dropdown with a searchable list",
              type: "boolean",
              default: true
            },
            { id: "labelData", type: "label", label: "Data source:" },
            {
              id: "flatstatsUrl",
              label: "flatstats base URL",
              type: "string",
              max: 120,
              default: DEFAULT_BASE_URL
            }
          ]
        });
        this.flatstats = null;
        this.itemIndex = null;
        this.postingModal = null;
        this.browser = null;
        this.typeahead = null;
        this.interception = null;
        this.ledger = createLedger({ log: (...a) => this.log(...a) });
      }
      /**
       * The game's vendor sell prices, from its own `item_sell_prices` global.
       *
       * Read through the BARE identifier, never globalThis. items.js declares it
       * with a top-level `let`, and let/const/class bindings live in the global
       * lexical environment rather than becoming properties of the global object
       * -- so `globalThis.item_sell_prices` is undefined while the plain name
       * resolves. (The same trap as the game's `class Map`; see flatstats.js.)
       *
       * Values are strings there, so coerce; absent items simply have no vendor.
       */
      vendorPrice(itemName) {
        try {
          const table = typeof item_sell_prices !== "undefined" ? item_sell_prices : null;
          if (!table) return null;
          const raw = table[itemName];
          const n = Number.parseInt(raw, 10);
          return Number.isFinite(n) && n > 0 ? n : null;
        } catch {
          return null;
        }
      }
      log(...args) {
        if (FlatMMOPlus?.debug) console.log("[Market+]", ...args);
      }
      /** Build collaborators lazily so a config change can rebuild them. */
      ensureWired() {
        if (this.postingModal) return;
        ensureStyles();
        this.flatstats = createFlatstatsClient({
          baseUrl: this.getConfig("flatstatsUrl") || DEFAULT_BASE_URL
        });
        this.itemIndex = createItemIndex({
          flatstats: this.flatstats,
          log: (...a) => this.log(...a)
        });
        this.postingModal = createPostingModalEnhancer({
          flatstats: this.flatstats,
          log: (...a) => this.log(...a),
          period: this.getConfig("statsPeriod") || "7d",
          showVerdict: this.getConfig("enableVerdict") !== false,
          ledger: this.getConfig("enableLedger") !== false ? this.ledger : null,
          getVendorPrice: (name) => this.vendorPrice(name)
        });
        if (this.getConfig("enableBrowser") !== false) {
          this.browser = createMarketBrowser({
            flatstats: this.flatstats,
            itemIndex: this.itemIndex,
            ledger: this.getConfig("enableLedger") !== false ? this.ledger : null,
            log: (...a) => this.log(...a)
          });
          this.interception = installMarketInterception({
            onOpen: (target) => this.browser.open(target)
          });
        }
        if (this.getConfig("enableTypeahead") !== false) {
          const input = document.getElementById("market-select-item-selecter-id");
          if (input) {
            this.typeahead = createTypeahead({ input, itemIndex: this.itemIndex });
          } else {
            this.log("item picker not found; typeahead disabled");
          }
        }
        this.seedLedgerFromDom();
        this.itemIndex.load();
      }
      /**
       * FlatMMO+ calls this when configs are LOADED as well as when they are
       * applied -- including every time the user merely opens the plugins panel.
       * Tearing down unconditionally would therefore uninstall the window.open
       * interception just for looking at the settings, so only rebuild when one
       * of this plugin's own configs actually changed.
       */
      seedLedgerFromDom() {
        try {
          const recovered = this.ledger.record(readRenderedHistory(document));
          if (recovered > 0) this.log(`recovered ${recovered} transaction(s) from the page`);
        } catch (err) {
          this.log("could not read rendered history:", err && err.message);
        }
      }
      onConfigsChanged() {
        const mine = /* @__PURE__ */ new Set([
          "enableMax",
          "enableVerdict",
          "statsPeriod",
          "flatstatsUrl",
          "enableBrowser",
          "enableTypeahead",
          "enableLedger"
        ]);
        const changed = [...this.changedConfigs || []].filter((id) => mine.has(id));
        if (changed.length === 0) {
          this.ensureWired();
          return;
        }
        this.teardown();
        this.ensureWired();
        this.log("rebuilt after config change:", changed.join(", "));
      }
      teardown() {
        if (this.interception) this.interception.uninstall();
        if (this.typeahead) this.typeahead.destroy();
        if (this.browser) this.browser.close();
        this.flatstats = null;
        this.itemIndex = null;
        this.postingModal = null;
        this.browser = null;
        this.typeahead = null;
        this.interception = null;
        this.ledger = createLedger({ log: (...a) => this.log(...a) });
      }
      /**
       * The game's vendor sell prices, from its own `item_sell_prices` global.
       *
       * Read through the BARE identifier, never globalThis. items.js declares it
       * with a top-level `let`, and let/const/class bindings live in the global
       * lexical environment rather than becoming properties of the global object
       * -- so `globalThis.item_sell_prices` is undefined while the plain name
       * resolves. (The same trap as the game's `class Map`; see flatstats.js.)
       *
       * Values are strings there, so coerce; absent items simply have no vendor.
       */
      vendorPrice(itemName) {
        try {
          const table = typeof item_sell_prices !== "undefined" ? item_sell_prices : null;
          if (!table) return null;
          const raw = table[itemName];
          const n = Number.parseInt(raw, 10);
          return Number.isFinite(n) && n > 0 ? n : null;
        } catch {
          return null;
        }
      }
      onLogin() {
        this.ensureWired();
      }
      onMessageReceived(data) {
        const frame = parseFrame(data);
        if (!frame) return;
        switch (frame.command) {
          case MARKET_COMMANDS.OPEN:
            this.ensureWired();
            break;
          case MARKET_COMMANDS.HISTORY: {
            const added = this.ledger.record(parseHistory(frame.values));
            if (added > 0) this.log(`recorded ${added} new transaction(s)`);
            break;
          }
          case MARKET_COMMANDS.ITEM_SELECTED: {
            if (!this.getConfig("enableMax")) return;
            this.ensureWired();
            const selection = parseItemSelected(frame.values);
            if (!selection) {
              this.log("unparseable item-selected frame:", data);
              return;
            }
            this.postingModal.onItemSelected(selection);
            break;
          }
          default:
            break;
        }
      }
    }
    return new MarketPlusPlugin();
  }
  var FRAMEWORK_URL = "https://update.greasyfork.org/scripts/544062/FlatMMOPlus.js";
  function waitForFlatMMOPlus(globals, { timeoutMs = 5e3, intervalMs = 100, setTimer = setTimeout, now = () => Date.now() } = {}) {
    return new Promise((resolve) => {
      const deadline = now() + timeoutMs;
      const poll = () => {
        if (globals.FlatMMOPlus && globals.FlatMMOPlusPlugin) {
          resolve({ FlatMMOPlus: globals.FlatMMOPlus, FlatMMOPlusPlugin: globals.FlatMMOPlusPlugin });
          return;
        }
        if (now() >= deadline) {
          resolve(null);
          return;
        }
        setTimer(poll, intervalMs);
      };
      poll();
    });
  }
  async function ensureFramework(globals, {
    doc = globals.document,
    waitMs = 5e3,
    loadWaitMs = 15e3,
    injectUrl = FRAMEWORK_URL,
    ...timing
  } = {}) {
    const present = await waitForFlatMMOPlus(globals, { ...timing, timeoutMs: waitMs });
    if (present) return { framework: present, injected: false };
    if (!doc || typeof doc.createElement !== "function") return { framework: null, injected: false };
    const script = doc.createElement("script");
    script.src = injectUrl;
    (doc.head || doc.documentElement).appendChild(script);
    const loaded = await waitForFlatMMOPlus(globals, { ...timing, timeoutMs: loadWaitMs });
    return { framework: loaded, injected: true };
  }
  async function boot(globals = globalThis, options = {}) {
    const { framework: found, injected } = await ensureFramework(globals, options);
    if (injected && found) {
      console.log("[Market+] no FlatMMO+ present; loaded the framework for you.");
    }
    if (!found) {
      console.warn(
        "[Market+] FlatMMO+ was not found and could not be loaded. Install it from https://greasyfork.org/scripts/544062 and reload."
      );
      return null;
    }
    const about = {
      name: globals.GM_info?.script?.name || "FlatMMO Market+",
      version: globals.GM_info?.script?.version || "0.0.0",
      author: globals.GM_info?.script?.author || "rannmann",
      description: globals.GM_info?.script?.description || ""
    };
    const plugin = definePlugin({ ...found, about });
    found.FlatMMOPlus.registerPlugin(plugin);
    return plugin;
  }

  // src/userscript.js
  boot(window);
})();
