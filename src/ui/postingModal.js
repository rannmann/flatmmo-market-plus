/**
 * Enhancements for the game's "Which item?" posting modal.
 *
 * The modal already has everything needed to answer "how many can I post?" --
 * the server sends the player's bank stock and coin balance in
 * CHANGED_MARKET_ITEM_POSTING_UI_SELECT, and the stock client prints one line
 * of text with them and discards the rest. This adds a MAX button and live
 * cost/proceeds figures on top of those same numbers.
 *
 * It never submits anything. MAX fills the amount field; posting stays a
 * deliberate click on the game's own button.
 */

import { PREFIX } from './styles.js';
import {
  maxBuyQuantity,
  maxSellQuantity,
  buyOrderCost,
  sellNetProceeds,
  estimateSellTax,
  compareToVendor,
} from '../money.js';
import { parseGameNumber, describeInputProblem } from '../gameNumber.js';
import { summarise, priceVerdict, suggestedPrice, formatCoins } from '../valuation.js';

const IDS = {
  amount: 'market-select-item-amount',
  price: 'market-select-item-price',
  type: 'market-select-item-type',
  content: 'post-item-content',
};

export function createPostingModalEnhancer({
  flatstats,
  doc = document,
  log = () => {},
  period = '7d',
  showVerdict = true,
  ledger = null,
  getVendorPrice = () => null,
} = {}) {
  let selection = null; // { item, bankAmount, coins }
  let summary = null; // valuation summary for the selected item
  let wired = false;

  function el(id) {
    return doc.getElementById(id);
  }

  function direction() {
    const v = el(IDS.type)?.value;
    return v === 'buy' || v === 'sell' ? v : null;
  }

  /** Create our elements once, and wire input listeners once. */
  function mount() {
    const content = el(IDS.content);
    const amountInput = el(IDS.amount);
    const priceInput = el(IDS.price);
    // Fail soft: a game update that renames any of these disables this feature
    // rather than breaking the modal.
    if (!content || !amountInput || !priceInput) {
      log('posting modal anchors missing; MAX disabled');
      return false;
    }

    if (!doc.getElementById(`${PREFIX}-max`)) {
      const max = doc.createElement('span');
      max.id = `${PREFIX}-max`;
      max.className = `${PREFIX}-btn`;
      max.textContent = 'MAX';
      max.setAttribute('role', 'button');
      max.addEventListener('click', onMaxClick);
      amountInput.insertAdjacentElement('afterend', max);
    }

    if (!doc.getElementById(`${PREFIX}-summary`)) {
      const panel = doc.createElement('div');
      panel.id = `${PREFIX}-summary`;
      panel.className = `${PREFIX}-panel`;
      // Sits directly above the Post Offer button, where the decision is made.
      priceInput.closest('div')?.insertAdjacentElement('afterend', panel);
    }

    if (!wired) {
      amountInput.addEventListener('input', update);
      priceInput.addEventListener('input', update);
      wired = true;
    }
    return true;
  }

  function onMaxClick() {
    if (!selection) return;
    const amountInput = el(IDS.amount);
    if (!amountInput) return;

    const price = parseGameNumber(el(IDS.price)?.value ?? '');
    const dir = direction();
    const qty =
      dir === 'buy' ? maxBuyQuantity(selection.coins, price) : maxSellQuantity(selection.bankAmount);

    if (qty <= 0) return;
    amountInput.value = String(qty);
    // Dispatch so anything else listening (including our own update) reacts as
    // it would to real typing.
    amountInput.dispatchEvent(new Event('input', { bubbles: true }));
    update();
  }

  /** Redraw the summary panel from current field values. */
  function update() {
    const panel = doc.getElementById(`${PREFIX}-summary`);
    if (!panel || !selection) return;

    const dir = direction();
    const rawAmount = el(IDS.amount)?.value ?? '';
    const rawPrice = el(IDS.price)?.value ?? '';
    const amount = parseGameNumber(rawAmount);
    const price = parseGameNumber(rawPrice);

    const maxBtn = doc.getElementById(`${PREFIX}-max`);
    if (maxBtn) {
      const canMax =
        dir === 'buy' ? maxBuyQuantity(selection.coins, price) > 0 : selection.bankAmount > 0;
      maxBtn.setAttribute('aria-disabled', canMax ? 'false' : 'true');
      maxBtn.title =
        dir === 'buy' && !Number.isFinite(price)
          ? 'Enter a price first — MAX depends on it'
          : 'Fill in the largest amount you can post';
    }

    panel.innerHTML = '';
    panel.appendChild(
      row(
        dir === 'buy' ? 'Coins available' : 'In bank',
        dir === 'buy'
          ? formatCoins(selection.coins)
          : `${formatCoins(selection.bankAmount)} × ${selection.item.replace(/_/g, ' ')}`
      )
    );

    if (Number.isFinite(amount) && Number.isFinite(price) && amount > 0 && price > 0) {
      if (dir === 'buy') {
        const cost = buyOrderCost(price, amount);
        panel.appendChild(row('Total cost', formatCoins(cost), cost > selection.coins ? 'bad' : ''));
        if (cost > selection.coins) {
          panel.appendChild(
            row('Short by', formatCoins(cost - selection.coins), 'bad')
          );
        }
      } else {
        const tax = estimateSellTax(price, amount);
        panel.appendChild(row('Gross', formatCoins(price * amount)));
        panel.appendChild(
          row(tax > 0 ? 'Tax (1%)' : 'Tax (under 100 each)', tax > 0 ? `-${formatCoins(tax)}` : 'none', tax > 0 ? 'warn' : 'muted')
        );
        panel.appendChild(row('You receive', `≈ ${formatCoins(sellNetProceeds(price, amount))}`, 'good'));
        if (amount > selection.bankAmount) {
          panel.appendChild(row('Over bank stock by', formatCoins(amount - selection.bankAmount), 'bad'));
        }
      }
    }

    if (showVerdict && summary && dir) {
      const verdict = priceVerdict({ price, direction: dir, summary });
      if (verdict.tone !== 'unknown') {
        panel.appendChild(row('Order', verdict.headline, toneClass(verdict.tone)));
      }
      if (verdict.comparison) {
        panel.appendChild(row('Price', verdict.comparison.label, 'muted'));
      }
      const book =
        summary.bestBuy !== null || summary.bestSell !== null
          ? `buy ${summary.bestBuy ?? '—'} / sell ${summary.bestSell ?? '—'}`
          : null;
      if (book) panel.appendChild(row('Best on book', book, 'muted'));
    }

    // A price that would put this order at the front of its side of the book.
    if (summary && dir) {
      const suggestion = suggestedPrice({ direction: dir, summary });
      if (suggestion !== null && suggestion !== price) {
        panel.appendChild(suggestionRow(suggestion, dir));
      }
    }

    // Selling cheap goods to the market is often worse than a vendor once tax
    // and the tied-up slot are considered, and the game never says so.
    if (dir === 'sell') {
      const vendor = compareToVendor({
        price,
        quantity: Number.isFinite(amount) && amount > 0 ? amount : 1,
        vendorPrice: getVendorPrice(selection.item),
      });
      if (vendor && vendor.better) {
        panel.appendChild(
          row(
            'Vendor would pay',
            formatCoins(vendor.vendorTotal),
            vendor.better === 'vendor' ? 'warn' : 'muted'
          )
        );
        if (vendor.better === 'vendor') {
          panel.appendChild(
            problemLine('A vendor pays more than this listing would net you after tax.')
          );
        }
      }
    }

    // append(), not appendChild(): appendChild takes a single node and would
    // silently drop every row after the heading.
    if (ledger) panel.append(...historyRows(selection.item, summary));

    for (const [field, raw] of [
      ['Amount', rawAmount],
      ['Price', rawPrice],
    ]) {
      const problem = describeInputProblem(raw);
      if (problem) panel.appendChild(problemLine(`${field}: ${problem}`));
    }
  }

  /**
   * What this player has actually done with this item before.
   * Returns an array so the caller can spread it -- an empty ledger adds nothing.
   */
  function historyRows(itemName, marketSummary) {
    const stats = ledger.summaryFor(itemName);
    if (!stats || stats.trades === 0) return [];

    const out = [heading('Your history')];

    if (stats.soldUnits > 0) {
      out.push(row('Sold all time', `${formatCoins(stats.soldUnits)} for ${formatCoins(stats.soldNet)}`));
      const avg = Math.round(stats.avgSalePrice);
      const marketNow = marketSummary ? marketSummary.bestSell : null;
      out.push(
        row(
          'Your average',
          marketNow !== null
            ? `${formatCoins(avg)} (market ${formatCoins(marketNow)})`
            : formatCoins(avg),
          marketNow !== null && marketNow > avg ? 'good' : 'muted'
        )
      );
    }

    if (stats.costBasisKnown) {
      out.push(row('Avg cost', formatCoins(Math.round(stats.avgCostBasis)), 'muted'));
      out.push(
        row(
          'Realised P/L',
          `${stats.realised >= 0 ? '+' : ''}${formatCoins(Math.round(stats.realised))}`,
          stats.realised >= 0 ? 'good' : 'bad'
        )
      );
    } else if (stats.soldUnits > 0) {
      // Revenue is not profit. Saying so is better than quietly implying it.
      out.push(row('Realised P/L', 'no purchase record', 'muted'));
    }

    for (const t of ledger.tradesFor(itemName).slice(0, 3)) {
      out.push(
        row(
          `${t.direction === 'sell' ? 'Sold' : 'Bought'} ${String(t.completedAt).slice(0, 10)}`,
          `${formatCoins(t.amount)} @ ${formatCoins(t.price)}`,
          'muted'
        )
      );
    }
    return out;
  }

  function heading(text) {
    const d = doc.createElement('div');
    d.className = `${PREFIX}-heading`;
    d.textContent = text;
    return d;
  }

  /** A one-click chip that fills the price field with a competitive price. */
  function suggestionRow(value, dir) {
    const wrap = doc.createElement('div');
    wrap.className = `${PREFIX}-row`;
    const l = doc.createElement('span');
    l.className = `${PREFIX}-label`;
    l.textContent = dir === 'sell' ? 'Undercut to' : 'Outbid at';
    const chip = doc.createElement('span');
    chip.className = `${PREFIX}-btn`;
    chip.textContent = formatCoins(value);
    chip.setAttribute('role', 'button');
    chip.addEventListener('click', () => {
      const priceInput = el(IDS.price);
      if (!priceInput) return;
      priceInput.value = String(value);
      priceInput.dispatchEvent(new Event('input', { bubbles: true }));
      update();
    });
    wrap.append(l, chip);
    return wrap;
  }

  function row(label, value, tone = '') {
    const wrap = doc.createElement('div');
    wrap.className = `${PREFIX}-row`;
    const l = doc.createElement('span');
    l.className = `${PREFIX}-label`;
    l.textContent = label;
    const v = doc.createElement('span');
    v.className = `${PREFIX}-value${tone ? ` ${PREFIX}-${tone}` : ''}`;
    v.textContent = value;
    wrap.append(l, v);
    return wrap;
  }

  function problemLine(text) {
    const d = doc.createElement('div');
    d.className = `${PREFIX}-problem`;
    d.textContent = text;
    return d;
  }

  function toneClass(tone) {
    return tone === 'good' ? 'good' : tone === 'warn' ? 'warn' : 'muted';
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
      flatstats
        .getItem(next.item, period)
        .then((detail) => {
          // Ignore a response that arrives after the player moved on.
          if (selection && selection.item === next.item) {
            summary = summarise(detail, period);
            update();
          }
        })
        .catch((err) => {
          log('flatstats lookup failed for', next.item, err && err.message);
        });
    },

    /** Exposed for the plugin to force a redraw. */
    refresh: update,
  };
}
