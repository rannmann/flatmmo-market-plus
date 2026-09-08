// Debug harness: exposes the posting-modal enhancer on window so it can be
// exercised against the live game DOM without FlatMMO+ present. Not shipped.
import { createPostingModalEnhancer } from './ui/postingModal.js';
import { createFlatstatsClient } from './flatstats.js';
import { ensureStyles } from './ui/styles.js';
import { parseFrame, parseItemSelected } from './protocol.js';

window.__marketPlusHarness = {
  install() {
    ensureStyles();
    const flatstats = createFlatstatsClient({});
    const enhancer = createPostingModalEnhancer({
      flatstats,
      log: (...a) => console.log('[Market+]', ...a),
    });
    window.__marketPlus = { enhancer, flatstats, parseFrame, parseItemSelected };
    return 'installed';
  },
};
