(() => {
  // src/ui/styles.js
  var PREFIX = "fmpm";
  var CSS = `
.${PREFIX}-panel {
  margin: 10px 0;
  padding: 10px 12px;
  border: 1px solid #3a3a3a;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.25);
  font-size: 0.85rem;
  line-height: 1.5;
  color: #d8d8d8;
  text-align: left;
}
.${PREFIX}-row { display: flex; justify-content: space-between; gap: 12px; }
.${PREFIX}-row + .${PREFIX}-row { margin-top: 4px; }
.${PREFIX}-label { color: #9a9a9a; }
.${PREFIX}-value { font-variant-numeric: tabular-nums; white-space: nowrap; }
.${PREFIX}-good { color: #8ce99a; }
.${PREFIX}-warn { color: #ffc46d; }
.${PREFIX}-bad { color: #ff8e8e; }
.${PREFIX}-muted { color: #8a8a8a; }

.${PREFIX}-btn {
  display: inline-block;
  padding: 2px 10px;
  margin-left: 6px;
  border: 1px solid #4a4a4a;
  border-radius: 4px;
  background: #2f2f2f;
  color: #e8e8e8;
  font-size: 0.78rem;
  cursor: pointer;
  user-select: none;
  vertical-align: middle;
}
.${PREFIX}-btn:hover { background: #3d3d3d; }
.${PREFIX}-btn[aria-disabled="true"] { opacity: 0.4; cursor: default; }
.${PREFIX}-btn[aria-disabled="true"]:hover { background: #2f2f2f; }

.${PREFIX}-problem {
  margin-top: 6px;
  padding: 5px 8px;
  border-left: 3px solid #ffc46d;
  background: rgba(255, 196, 109, 0.08);
  color: #ffc46d;
  font-size: 0.8rem;
}

.${PREFIX}-spark { display: block; width: 100%; height: 40px; margin-top: 6px; }
.${PREFIX}-spark-line { fill: none; stroke: #8ce99a; stroke-width: 1.5; }
.${PREFIX}-spark-area { fill: rgba(140, 233, 154, 0.12); stroke: none; }
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
    showVerdict = true
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
      for (const [field, raw] of [
        ["Amount", rawAmount],
        ["Price", rawPrice]
      ]) {
        const problem = describeInputProblem(raw);
        if (problem) panel.appendChild(problemLine(`${field}: ${problem}`));
      }
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
    const cache = /* @__PURE__ */ new Map();
    const inFlight = /* @__PURE__ */ new Map();
    const root = String(baseUrl).replace(/\/+$/, "");
    async function request(path) {
      const cached = cache.get(path);
      if (cached && cached.expires > now()) return cached.value;
      const pending = inFlight.get(path);
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
          cache.set(path, { value, expires: now() + ttlMs });
          return value;
        } finally {
          clearTimeout(timer);
          inFlight.delete(path);
        }
      })();
      inFlight.set(path, promise);
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
        cache.clear();
      }
    };
  }
  function isSafeItemName(name) {
    return typeof name === "string" && /^[a-z0-9_]+$/i.test(name);
  }

  // src/protocol.js
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

  // src/harness.js
  window.__marketPlusHarness = {
    install() {
      ensureStyles();
      const flatstats = createFlatstatsClient({});
      const enhancer = createPostingModalEnhancer({
        flatstats,
        log: (...a) => console.log("[Market+]", ...a)
      });
      window.__marketPlus = { enhancer, flatstats, parseFrame, parseItemSelected };
      return "installed";
    }
  };
})();
