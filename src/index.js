/**
 * FlatMMO Market+ — a FlatMMO+ plugin that rebuilds the Global Market UI.
 *
 * Strictly read-only with respect to gameplay. It listens to market frames the
 * server already sends, reads public market data from flatstats, and renders.
 * The one thing it writes is the amount field, when the player clicks MAX --
 * posting an offer remains a deliberate click on the game's own button.
 */

import { createFlatstatsClient, DEFAULT_BASE_URL } from './flatstats.js';
import { createItemIndex } from './itemIndex.js';
import { createPostingModalEnhancer } from './ui/postingModal.js';
import { createMarketBrowser } from './ui/browser.js';
import { createTypeahead } from './ui/typeahead.js';
import { installMarketInterception } from './ui/intercept.js';
import { ensureStyles } from './ui/styles.js';
import {
  parseFrame,
  parseItemSelected,
  parseHistory,
  parsePostings,
  MARKET_COMMANDS,
} from './protocol.js';
import { createLedger } from './ledger.js';
import { createOrderTracker } from './orders.js';
import { readRenderedHistory } from './domHistory.js';

const PLUGIN_ID = 'marketplus';

export function definePlugin({ FlatMMOPlusPlugin, FlatMMOPlus, about }) {
  class MarketPlusPlugin extends FlatMMOPlusPlugin {
    constructor() {
      super(PLUGIN_ID, {
        about,
        config: [
          { id: 'labelPosting', type: 'label', label: 'Posting modal:' },
          {
            id: 'enableMax',
            label: 'Show MAX button and live totals',
            type: 'boolean',
            default: true,
          },
          {
            id: 'enableVerdict',
            label: 'Compare prices against flatstats history',
            type: 'boolean',
            default: true,
          },
          {
            id: 'statsPeriod',
            label: 'History window for price comparison',
            type: 'select',
            options: [
              { value: '24h', label: 'Last 24 hours' },
              { value: '7d', label: 'Last 7 days' },
            ],
            default: '7d',
          },
          { id: 'labelBrowser', type: 'label', label: 'Market browser:' },
          {
            id: 'enableBrowser',
            label: 'Open the order book in game instead of a new tab',
            type: 'boolean',
            default: true,
          },
          {
            id: 'enableTypeahead',
            label: 'Replace the item dropdown with a searchable list',
            type: 'boolean',
            default: true,
          },
          { id: 'labelData', type: 'label', label: 'Data source:' },
          {
            id: 'flatstatsUrl',
            label: 'flatstats base URL',
            type: 'string',
            max: 120,
            default: DEFAULT_BASE_URL,
          },
        ],
      });

      this.flatstats = null;
      this.itemIndex = null;
      this.postingModal = null;
      this.browser = null;
      this.typeahead = null;
      this.interception = null;
      // The ledger outlives teardown: it is accumulated data, not page wiring,
      // and rebuilding it on every config change would lose nothing but is
      // pointless churn.
      this.ledger = createLedger({ log: (...a) => this.log(...a) });
      // Exact accounting, keyed by each listing's uuid. Unlike the ledger this
      // cannot double-count a refilled order, and it sees purchases.
      this.orders = createOrderTracker({ log: (...a) => this.log(...a) });
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
        const table = typeof item_sell_prices !== 'undefined' ? item_sell_prices : null;
        if (!table) return null;
        const raw = table[itemName];
        const n = Number.parseInt(raw, 10);
        return Number.isFinite(n) && n > 0 ? n : null;
      } catch {
        return null;
      }
    }

    log(...args) {
      if (FlatMMOPlus?.debug) console.log('[Market+]', ...args);
    }

    /** Build collaborators lazily so a config change can rebuild them. */
    ensureWired() {
      if (this.postingModal) return;
      ensureStyles();
      this.flatstats = createFlatstatsClient({
        baseUrl: this.getConfig('flatstatsUrl') || DEFAULT_BASE_URL,
      });
      this.itemIndex = createItemIndex({
        flatstats: this.flatstats,
        log: (...a) => this.log(...a),
      });
      this.postingModal = createPostingModalEnhancer({
        flatstats: this.flatstats,
        log: (...a) => this.log(...a),
        period: this.getConfig('statsPeriod') || '7d',
        showVerdict: this.getConfig('enableVerdict') !== false,
        ledger: this.getConfig('enableLedger') !== false ? this.ledger : null,
        orders: this.getConfig('enableLedger') !== false ? this.orders : null,
        getVendorPrice: (name) => this.vendorPrice(name),
      });

      if (this.getConfig('enableBrowser') !== false) {
        this.browser = createMarketBrowser({
          flatstats: this.flatstats,
          itemIndex: this.itemIndex,
          ledger: this.getConfig('enableLedger') !== false ? this.ledger : null,
          log: (...a) => this.log(...a),
        });
        this.interception = installMarketInterception({
          onOpen: (target) => this.browser.open(target),
        });
      }

      if (this.getConfig('enableTypeahead') !== false) {
        const input = document.getElementById('market-select-item-selecter-id');
        if (input) {
          this.typeahead = createTypeahead({ input, itemIndex: this.itemIndex });
        } else {
          this.log('item picker not found; typeahead disabled');
        }
      }

      // Recover any transactions the game rendered before the socket hook was
      // installed -- which is every one of them when the market panel is
      // already open as the page loads. Marked provisional; real frames win.
      this.seedLedgerFromDom();

      // Warm the name/icon index in the background; the UI degrades to raw
      // snake_case names if it never arrives.
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
        this.log('could not read rendered history:', err && err.message);
      }
    }

    onConfigsChanged() {
      const mine = new Set([
        'enableMax',
        'enableVerdict',
        'statsPeriod',
        'flatstatsUrl',
        'enableBrowser',
        'enableTypeahead',
        'enableLedger',
      ]);
      const changed = [...(this.changedConfigs || [])].filter((id) => mine.has(id));
      if (changed.length === 0) {
        // A load or panel visit: make sure we are wired, but change nothing.
        this.ensureWired();
        return;
      }
      // Undo the page patches before dropping references, or a rebuild would
      // stack a second window.open wrapper on top of the first.
      this.teardown();
      this.ensureWired();
      this.log('rebuilt after config change:', changed.join(', '));
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
      // The ledger outlives teardown: it is accumulated data, not page wiring,
      // and rebuilding it on every config change would lose nothing but is
      // pointless churn.
      this.ledger = createLedger({ log: (...a) => this.log(...a) });
      // Exact accounting, keyed by each listing's uuid. Unlike the ledger this
      // cannot double-count a refilled order, and it sees purchases.
      this.orders = createOrderTracker({ log: (...a) => this.log(...a) });
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
        const table = typeof item_sell_prices !== 'undefined' ? item_sell_prices : null;
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

        case MARKET_COMMANDS.POSTINGS: {
          const moved = this.orders.observe(parsePostings(frame.values));
          if (moved > 0) this.log(`${moved} order(s) updated`);
          break;
        }

        case MARKET_COMMANDS.HISTORY: {
          // The feed is re-sent whole each time the panel opens; the ledger
          // deduplicates and keeps anything the server later stops reporting.
          const added = this.ledger.record(parseHistory(frame.values));
          if (added > 0) this.log(`recorded ${added} new transaction(s)`);
          break;
        }

        case MARKET_COMMANDS.ITEM_SELECTED: {
          if (!this.getConfig('enableMax')) return;
          this.ensureWired();
          const selection = parseItemSelected(frame.values);
          if (!selection) {
            this.log('unparseable item-selected frame:', data);
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

/** Where the framework is published, if nothing else has loaded it. */
export const FRAMEWORK_URL = 'https://update.greasyfork.org/scripts/544062/FlatMMOPlus.js';

/** Wait for FlatMMO+ to appear on the window. */
export function waitForFlatMMOPlus(
  globals,
  { timeoutMs = 5_000, intervalMs = 100, setTimer = setTimeout, now = () => Date.now() } = {}
) {
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

/**
 * Get a framework instance, loading one only as a last resort.
 *
 * This plugin deliberately does NOT `@require` FlatMMOPlus.js the way the other
 * plugins do. Tampermonkey caches required files per script and only refetches
 * when that script updates, so plugins installed at different times each carry
 * their own FMP build. FMP's re-entry guard is
 *
 *     if (pageWindow.FlatMMOPlus.version >= VERSION) return;
 *
 * -- a string comparison, so "1.5.4.1" >= "1.5.5" is false. A copy NEWER than
 * the one already running skips the guard, takes the upgrade path, inherits the
 * registered plugin list and re-registers its own `handler` into it. That throws
 * and leaves every other plugin with null configs. It also misfires on ordinary
 * version bumps such as 1.5.9 -> 1.5.10.
 *
 * So: wait first, and inject a copy only when nothing at all has provided one.
 * A user already running any FlatMMO+ plugin never loads a second framework; a
 * user with none still gets it without a separate install.
 */
export async function ensureFramework(
  globals,
  {
    doc = globals.document,
    waitMs = 5_000,
    loadWaitMs = 15_000,
    injectUrl = FRAMEWORK_URL,
    ...timing
  } = {}
) {
  const present = await waitForFlatMMOPlus(globals, { ...timing, timeoutMs: waitMs });
  if (present) return { framework: present, injected: false };

  if (!doc || typeof doc.createElement !== 'function') return { framework: null, injected: false };

  const script = doc.createElement('script');
  script.src = injectUrl;
  (doc.head || doc.documentElement).appendChild(script);

  // Re-poll rather than trusting onload: the framework publishes its globals
  // synchronously at the end of its own IIFE.
  const loaded = await waitForFlatMMOPlus(globals, { ...timing, timeoutMs: loadWaitMs });
  return { framework: loaded, injected: true };
}

/** Entry point used by the built userscript. */
export async function boot(globals = globalThis, options = {}) {
  const { framework: found, injected } = await ensureFramework(globals, options);
  if (injected && found) {
    console.log('[Market+] no FlatMMO+ present; loaded the framework for you.');
  }
  if (!found) {
    console.warn(
      '[Market+] FlatMMO+ was not found and could not be loaded. Install it from ' +
        'https://greasyfork.org/scripts/544062 and reload.'
    );
    return null;
  }

  const about = {
    name: globals.GM_info?.script?.name || 'FlatMMO Market+',
    version: globals.GM_info?.script?.version || '0.0.0',
    author: globals.GM_info?.script?.author || 'rannmann',
    description: globals.GM_info?.script?.description || '',
  };
  const plugin = definePlugin({ ...found, about });
  found.FlatMMOPlus.registerPlugin(plugin);
  return plugin;
}
