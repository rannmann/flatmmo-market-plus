// Thin entry point for the bundled userscript. Kept separate from index.js so
// that index.js stays importable by tests without booting against the game.
import { boot } from './index.js';

boot(window);
