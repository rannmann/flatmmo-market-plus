/**
 * The in-game market browser.
 *
 * Replaces the game's `window.open(".../market/listing/<item>/view/")` tab jump
 * with an overlay rendered in the page, so looking up a price never leaves the
 * game. Data comes from flatstats rather than market.flatmmo.com: the tracker
 * already has the order book plus history the market site does not expose.
 *
 * Read-only. Nothing here posts, cancels, or collects an order.
 */

import { PREFIX } from './styles.js';
import { buildSparkline, toEpoch } from '../chart.js';
import { formatCoins } from '../valuation.js';
import { searchItems } from '../search.js';

export function createMarketBrowser({
  flatstats,
  itemIndex,
  ledger = null,
  doc = document,
  log = () => {},
}) {
  let overlay = null;
  let overviewCache = null;
  let sort = 'hot';

  function close() {
    if (overlay) overlay.remove();
    overlay = null;
    doc.removeEventListener('keydown', onKey);
  }

  function ensureOverlay() {
    if (overlay && overlay.isConnected) return overlay;
    overlay = doc.createElement('div');
    overlay.className = `${PREFIX}-overlay`;
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    doc.body.appendChild(overlay);
    // Removed again in close(); without that, each open would stack another
    // Escape handler on the document.
    doc.addEventListener('keydown', onKey);
    return overlay;
  }

  function onKey(e) {
    if (e.key === 'Escape' && overlay) close();
  }

  function shell(title, { onBack } = {}) {
    const o = ensureOverlay();
    o.innerHTML = '';
    const panel = doc.createElement('div');
    panel.className = `${PREFIX}-sheet`;

    const head = doc.createElement('div');
    head.className = `${PREFIX}-sheet-head`;

    if (onBack) {
      const back = doc.createElement('span');
      back.className = `${PREFIX}-btn`;
      back.textContent = '‹ All items';
      back.addEventListener('click', onBack);
      head.appendChild(back);
    }

    const h = doc.createElement('div');
    h.className = `${PREFIX}-sheet-title`;
    h.textContent = title;
    head.appendChild(h);

    const x = doc.createElement('span');
    x.className = `${PREFIX}-sheet-close`;
    x.textContent = '×';
    x.addEventListener('click', close);
    head.appendChild(x);

    const body = doc.createElement('div');
    body.className = `${PREFIX}-sheet-body`;

    panel.append(head, body);
    o.appendChild(panel);
    return body;
  }

  function loading(body) {
    const d = doc.createElement('div');
    d.className = `${PREFIX}-loading`;
    d.textContent = 'Loading…';
    body.appendChild(d);
  }

  function failure(body, err) {
    const d = doc.createElement('div');
    d.className = `${PREFIX}-loading`;
    d.textContent = `Could not reach flatstats: ${err && err.message ? err.message : 'unknown error'}`;
    body.appendChild(d);
  }

  // ---------------------------------------------------------------- item view

  async function openItem(name) {
    const body = shell(itemIndex.displayName(name), {
      onBack: overviewCache ? () => openAll() : null,
    });
    loading(body);
    try {
      const detail = await flatstats.getItem(name, '7d');
      body.innerHTML = '';
      renderItem(body, name, detail);
    } catch (err) {
      body.innerHTML = '';
      failure(body, err);
      log('item view failed', name, err && err.message);
    }
  }

  function renderItem(body, name, detail) {
    const stats7 = detail?.stats?.['7d'] || {};
    const stats24 = detail?.stats?.['24h'] || {};

    body.appendChild(
      statsStrip([
        ['Best buy', detail.best_buy != null ? formatCoins(detail.best_buy) : '—'],
        ['Best sell', detail.best_sell != null ? formatCoins(detail.best_sell) : '—'],
        [
          'Spread',
          detail.best_buy != null && detail.best_sell != null
            ? formatCoins(detail.best_sell - detail.best_buy)
            : '—',
        ],
        ['7d avg', stats7.avg_price ? formatCoins(Math.round(stats7.avg_price)) : '—'],
        ['24h volume', formatCoins(stats24.volume || 0)],
      ])
    );

    const spark = priceSeries(detail);
    if (spark) body.appendChild(spark);

    const ladders = doc.createElement('div');
    ladders.className = `${PREFIX}-ladders`;
    ladders.append(
      ladder('Buy orders', detail?.book?.buys || [], 'buy'),
      ladder('Sell orders', detail?.book?.sells || [], 'sell')
    );
    body.appendChild(ladders);

    const trades = Array.isArray(detail.trades) ? detail.trades.slice().reverse() : [];
    body.appendChild(tradeTable(trades));

    if (ledger) {
      const mine = ledger.tradesFor(name);
      if (mine.length > 0) body.appendChild(myTradesTable(mine, ledger.summaryFor(name)));
    }
  }

  /** This player's own transactions for the item, with their totals. */
  function myTradesTable(mine, stats) {
    const wrap = doc.createElement('div');
    wrap.className = `${PREFIX}-ladder`;

    const h = doc.createElement('div');
    h.className = `${PREFIX}-ladder-title`;
    h.textContent = 'Your trades';
    wrap.appendChild(h);

    wrap.appendChild(
      statsStrip(
        [
          ['Units sold', formatCoins(stats.soldUnits)],
          ['Net received', formatCoins(stats.soldNet)],
          ['Your average', stats.avgSalePrice ? formatCoins(Math.round(stats.avgSalePrice)) : '—'],
          [
            'Realised P/L',
            // Without purchase records there is no cost basis, and reporting
            // revenue as profit would overstate it by whatever the goods cost.
            stats.costBasisKnown ? formatCoins(Math.round(stats.realised)) : 'unknown',
          ],
        ].filter(Boolean)
      )
    );

    const table = doc.createElement('table');
    table.className = `${PREFIX}-table`;
    table.innerHTML = '<thead><tr><th>When</th><th>Side</th><th>Quantity</th><th>Price</th></tr></thead>';
    const tbody = doc.createElement('tbody');
    for (const t of mine.slice(0, 25)) {
      const tr = doc.createElement('tr');
      tr.innerHTML =
        `<td class="${PREFIX}-muted">${escapeHtml(String(t.completedAt).slice(0, 16))}</td>` +
        `<td class="${PREFIX}-${t.direction === 'sell' ? 'bad' : 'good'}">${t.direction}</td>` +
        `<td>${formatCoins(t.amount)}</td>` +
        `<td>${formatCoins(t.price)}</td>`;
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  }

  /** A price line built from the hourly book samples, falling back to trades. */
  function priceSeries(detail) {
    const fromBook = (detail.book_history || [])
      .map((row) => ({ x: toEpoch(row.sampled_at), y: numberOrNull(row.best_sell) }))
      .filter((p) => p.x !== null);
    const fromTrades = (detail.trades || [])
      .map((row) => ({ x: toEpoch(row.completed_on), y: numberOrNull(row.price) }))
      .filter((p) => p.x !== null);

    const series = fromBook.filter((p) => p.y !== null).length >= 2 ? fromBook : fromTrades;
    const geom = buildSparkline(series, { width: 560, height: 70, padding: 4 });
    if (!geom) return null;

    const wrap = doc.createElement('div');
    wrap.className = `${PREFIX}-chart`;

    const caption = doc.createElement('div');
    caption.className = `${PREFIX}-chart-caption`;
    caption.textContent =
      `${series === fromBook ? 'Best sell' : 'Traded price'}, 7 days · ` +
      `low ${formatCoins(geom.minY)} · high ${formatCoins(geom.maxY)}`;

    const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 560 70');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('class', `${PREFIX}-spark`);

    const area = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
    area.setAttribute('d', geom.area);
    area.setAttribute('class', `${PREFIX}-spark-area`);

    const line = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
    line.setAttribute('d', geom.line);
    line.setAttribute('class', `${PREFIX}-spark-line`);

    svg.append(area, line);
    wrap.append(caption, svg);
    return wrap;
  }

  /** One side of the book, with a running total so depth is readable at a glance. */
  function ladder(title, rows, side) {
    const wrap = doc.createElement('div');
    wrap.className = `${PREFIX}-ladder`;

    const h = doc.createElement('div');
    h.className = `${PREFIX}-ladder-title`;
    h.textContent = title;
    wrap.appendChild(h);

    if (rows.length === 0) {
      const empty = doc.createElement('div');
      empty.className = `${PREFIX}-muted`;
      empty.textContent = 'No orders';
      wrap.appendChild(empty);
      return wrap;
    }

    const table = doc.createElement('table');
    table.className = `${PREFIX}-table`;
    table.innerHTML =
      '<thead><tr><th>Price</th><th>Quantity</th><th>Cumulative</th></tr></thead>';
    const tbody = doc.createElement('tbody');

    let cumulative = 0;
    for (const row of rows) {
      cumulative += row.quantity;
      const tr = doc.createElement('tr');
      tr.innerHTML =
        `<td class="${PREFIX}-${side === 'buy' ? 'good' : 'bad'}">${formatCoins(row.price)}</td>` +
        `<td>${formatCoins(row.quantity)}</td>` +
        `<td class="${PREFIX}-muted">${formatCoins(cumulative)}</td>`;
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  }

  function tradeTable(trades) {
    const wrap = doc.createElement('div');
    wrap.className = `${PREFIX}-ladder`;
    const h = doc.createElement('div');
    h.className = `${PREFIX}-ladder-title`;
    h.textContent = 'Recent trades';
    wrap.appendChild(h);

    if (trades.length === 0) {
      const empty = doc.createElement('div');
      empty.className = `${PREFIX}-muted`;
      empty.textContent = 'No trades in the last 7 days';
      wrap.appendChild(empty);
      return wrap;
    }

    const table = doc.createElement('table');
    table.className = `${PREFIX}-table`;
    table.innerHTML = '<thead><tr><th>When</th><th>Quantity</th><th>Price</th></tr></thead>';
    const tbody = doc.createElement('tbody');
    for (const t of trades.slice(0, 15)) {
      const tr = doc.createElement('tr');
      tr.innerHTML =
        `<td class="${PREFIX}-muted">${(t.completed_on || '').slice(0, 16)}</td>` +
        `<td>${formatCoins(t.amount_sold)}</td>` +
        `<td>${formatCoins(t.price)}</td>`;
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  }

  // ------------------------------------------------------------ overview view

  async function openAll() {
    const body = shell('Global Market');
    loading(body);
    try {
      const data = overviewCache || (await flatstats.getOverview(sort));
      overviewCache = data;
      body.innerHTML = '';
      renderAll(body, data);
    } catch (err) {
      body.innerHTML = '';
      failure(body, err);
      log('overview failed', err && err.message);
    }
  }

  function renderAll(body, data) {
    const s = data.summary || {};
    body.appendChild(
      statsStrip([
        ['Items trading', formatCoins(s.active_items || 0)],
        ['Open buy orders', formatCoins(s.buy_orders || 0)],
        ['Buy escrow', formatCoins(s.buy_escrow || 0)],
        ['24h volume', formatCoins(s.volume_24h || 0)],
        ['24h fills', formatCoins(s.orders_completed_24h || 0)],
      ])
    );

    const controls = doc.createElement('div');
    controls.className = `${PREFIX}-controls`;

    const filter = doc.createElement('input');
    filter.className = `${PREFIX}-filter`;
    filter.placeholder = 'Filter items…';

    const sortSel = doc.createElement('select');
    sortSel.className = `${PREFIX}-sort`;
    for (const [value, label] of [
      ['hot', 'Hottest'],
      ['volume', '24h volume'],
      ['margin', 'Margin'],
      ['roi', 'ROI'],
      ['name', 'Name'],
    ]) {
      const opt = doc.createElement('option');
      opt.value = value;
      opt.textContent = label;
      if (value === sort) opt.selected = true;
      sortSel.appendChild(opt);
    }
    sortSel.addEventListener('change', async () => {
      sort = sortSel.value;
      overviewCache = null;
      await openAll();
    });

    controls.append(filter, sortSel);
    body.appendChild(controls);

    const host = doc.createElement('div');
    body.appendChild(host);

    const draw = () => {
      const query = filter.value.trim();
      const pool = (data.items || []).map((i) => ({
        ...i,
        name: i.item_name,
        displayName: i.display_name || i.item_name,
      }));
      const rows = query
        ? searchItems(query, pool, { limit: 200 }).map((r) => r.item)
        : pool.slice(0, 200);
      host.innerHTML = '';
      host.appendChild(overviewTable(rows));
    };
    filter.addEventListener('input', draw);
    draw();
    filter.focus();
  }

  function overviewTable(rows) {
    const table = doc.createElement('table');
    table.className = `${PREFIX}-table ${PREFIX}-table-hover`;
    table.innerHTML =
      '<thead><tr><th>Item</th><th>Best buy</th><th>Best sell</th>' +
      '<th>Margin</th><th>24h volume</th></tr></thead>';
    const tbody = doc.createElement('tbody');

    if (rows.length === 0) {
      const tr = doc.createElement('tr');
      tr.innerHTML = `<td colspan="5" class="${PREFIX}-muted">Nothing matches</td>`;
      tbody.appendChild(tr);
    }

    for (const row of rows) {
      const tr = doc.createElement('tr');
      tr.className = `${PREFIX}-row-click`;
      tr.innerHTML =
        `<td><img class="${PREFIX}-ta-icon" src="${escapeHtml(itemIndex.iconUrl(row.name))}" alt="">` +
        `<span>${escapeHtml(row.displayName)}</span></td>` +
        `<td class="${PREFIX}-good">${row.buy_price != null ? formatCoins(row.buy_price) : '—'}</td>` +
        `<td class="${PREFIX}-bad">${row.sell_price != null ? formatCoins(row.sell_price) : '—'}</td>` +
        `<td>${row.margin != null ? formatCoins(row.margin) : '—'}</td>` +
        `<td>${formatCoins(row.volume_24h || 0)}</td>`;
      tr.addEventListener('click', () => openItem(row.name));
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    return table;
  }

  // --------------------------------------------------------------- shared bits

  function statsStrip(pairs) {
    const strip = doc.createElement('div');
    strip.className = `${PREFIX}-strip`;
    for (const [label, value] of pairs) {
      const cell = doc.createElement('div');
      cell.className = `${PREFIX}-strip-cell`;
      const l = doc.createElement('div');
      l.className = `${PREFIX}-strip-label`;
      l.textContent = label;
      const v = doc.createElement('div');
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
      if (target.kind === 'all') openAll();
      else openItem(target.item);
    },
    close,
  };
}

function numberOrNull(v) {
  return Number.isFinite(v) ? v : null;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}
