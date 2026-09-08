/**
 * Replaces the game's native <datalist> item picker with a real typeahead.
 *
 * The stock control is `<input list="market-select-item-selecter">` over a
 * datalist of raw snake_case names, which only prefix-matches -- so finding
 * Unpowered Orb requires knowing to type "unpowered_orb". This ranks over
 * display names, matches anywhere in the string, and shows item icons.
 *
 * The original input element is kept and its value is what gets set, because
 * `post_market_offer()` reads that element directly. Selecting a result sets
 * the value and dispatches `input`, which lets the game's own handler fire
 * `on_market_item_change` -- so the request to the server is still the game's,
 * not ours, and can never double-fire.
 */

import { PREFIX } from './styles.js';
import { searchItems } from '../search.js';

export function createTypeahead({ input, itemIndex, doc = document, maxResults = 8 }) {
  if (!input) return null;

  let box = null;
  let results = [];
  let active = -1;

  // The native datalist would render its own dropdown on top of ours.
  const originalList = input.getAttribute('list');
  input.removeAttribute('list');
  input.setAttribute('autocomplete', 'off');

  /**
   * The set of names the game will actually accept, read from the datalist the
   * game populates from api/db/items.php. Restricting to it means the typeahead
   * can never offer something the server would reject.
   */
  function allowedNames() {
    const list = originalList ? doc.getElementById(originalList) : null;
    if (!list || !list.options || list.options.length === 0) return null;
    const names = new Set();
    for (const opt of list.options) names.add(opt.value);
    return names;
  }

  /**
   * The list lives on <body> with fixed positioning rather than next to the
   * input. The posting modal scrolls its own content, so a list rendered inside
   * it gets clipped after a couple of rows -- which is exactly what happened in
   * testing. Positioning against the viewport takes every ancestor's overflow
   * and stacking context out of the picture.
   */
  function ensureBox() {
    if (box && box.isConnected) return box;
    box = doc.createElement('div');
    box.className = `${PREFIX}-ta`;
    box.setAttribute('role', 'listbox');
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

    // Flip above the input when there is more room up there.
    if (spaceBelow < 160 && r.top > spaceBelow) {
      box.style.top = 'auto';
      box.style.bottom = `${viewportH - r.top + 2}px`;
      box.style.maxHeight = `${Math.max(80, r.top - 8)}px`;
    } else {
      box.style.bottom = 'auto';
      box.style.top = `${r.bottom + 2}px`;
      box.style.maxHeight = `${Math.max(80, spaceBelow - 8)}px`;
    }
  }

  function close() {
    if (box) box.remove();
    box = null;
    results = [];
    active = -1;
    window.removeEventListener('scroll', positionBox, true);
    window.removeEventListener('resize', positionBox);
  }

  function choose(index) {
    const chosen = results[index];
    if (!chosen) return;
    input.value = chosen.item.name;
    close();
    // Let the game's own oninput see an exact option match and request the item.
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function render() {
    const el = ensureBox();
    el.innerHTML = '';
    if (results.length === 0) {
      close();
      return;
    }
    // Anchored to the viewport, so it has to follow the input if either moves.
    window.addEventListener('scroll', positionBox, true);
    window.addEventListener('resize', positionBox);

    results.forEach(({ item }, i) => {
      const row = doc.createElement('div');
      row.className = `${PREFIX}-ta-row${i === active ? ` ${PREFIX}-ta-active` : ''}`;
      row.setAttribute('role', 'option');

      const icon = doc.createElement('img');
      icon.className = `${PREFIX}-ta-icon`;
      icon.src = itemIndex.iconUrl(item.name);
      icon.alt = '';
      // Items with no artwork must not leave a broken-image glyph in the list.
      icon.addEventListener('error', () => {
        icon.style.visibility = 'hidden';
      });

      const label = doc.createElement('span');
      label.className = `${PREFIX}-ta-name`;
      label.textContent = item.displayName;

      const raw = doc.createElement('span');
      raw.className = `${PREFIX}-ta-raw`;
      raw.textContent = item.name;

      row.append(icon, label, raw);
      // mousedown, not click: blurring the input first would close the list.
      row.addEventListener('mousedown', (e) => {
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
    // An exact name means the game has already accepted it; nothing to offer.
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
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      active = (active + 1) % results.length;
      render();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      active = (active - 1 + results.length) % results.length;
      render();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(active);
    } else if (e.key === 'Escape') {
      close();
    }
  }

  input.addEventListener('input', refresh);
  input.addEventListener('keydown', onKeyDown);
  input.addEventListener('blur', () => setTimeout(close, 120));

  return {
    close,
    /** Restore the game's native control. */
    destroy() {
      close();
      input.removeEventListener('input', refresh);
      input.removeEventListener('keydown', onKeyDown);
      if (originalList) input.setAttribute('list', originalList);
    },
  };
}
