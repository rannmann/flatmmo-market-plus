/**
 * Catches the game's attempts to send the player to market.flatmmo.com.
 *
 * Two routes exist. The postings list uses inline
 * `onclick="window.open('...','_blank')"`, and the posting modal uses a plain
 * `<a href>` ("View More Data"). Rather than rewriting those elements -- which
 * the game destroys and rebuilds on every REFRESH_MARKET_UI_POSTINGS -- this
 * intercepts at the two places the navigation actually happens, so it survives
 * any amount of re-rendering.
 *
 * Only URLs that parse as market listing pages are diverted; every other
 * window.open and link behaves exactly as before.
 */

import { parseMarketUrl } from '../marketUrl.js';

export function installMarketInterception({ target = window, doc = document, onOpen }) {
  const originalOpen = target.open;

  target.open = function patchedOpen(url, ...rest) {
    const parsed = parseMarketUrl(typeof url === 'string' ? url : '');
    if (parsed) {
      onOpen(parsed);
      // The game ignores the return value; null is what a blocked popup gives.
      return null;
    }
    return originalOpen.apply(this, [url, ...rest]);
  };

  function onClick(event) {
    const anchor =
      event.target && event.target.closest ? event.target.closest('a[href]') : null;
    if (!anchor) return;
    const parsed = parseMarketUrl(anchor.getAttribute('href'));
    if (!parsed) return;
    event.preventDefault();
    event.stopPropagation();
    onOpen(parsed);
  }

  // Capture phase, so the link is diverted before any game handler runs.
  doc.addEventListener('click', onClick, true);

  return {
    uninstall() {
      target.open = originalOpen;
      doc.removeEventListener('click', onClick, true);
    },
  };
}
