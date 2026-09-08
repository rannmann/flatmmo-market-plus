/**
 * Bundles src/ into a single installable userscript.
 *
 * FlatMMO+ plugins ship as one file with a UserScript header, but writing the
 * plugin as one file would make the pure logic untestable. So the source stays
 * modular and esbuild flattens it, preserving the header verbatim as a banner.
 */
import { build } from 'esbuild';
import { readFileSync, mkdirSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

const banner = `// ==UserScript==
// @name         FlatMMO Market+
// @namespace    org.ravenwoodsoftware.flatmmo.marketplus
// @version      ${pkg.version}
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
`;

mkdirSync(new URL('./dist/', import.meta.url), { recursive: true });

const watch = process.argv.includes('--watch');

const options = {
  entryPoints: ['src/userscript.js'],
  outfile: 'dist/flatmmo-market-plus.user.js',
  bundle: true,
  format: 'iife',
  target: 'es2020',
  banner: { js: banner },
  // Readable output: this ships as source to users and to Greasyfork reviewers.
  minify: false,
  legalComments: 'inline',
};

if (watch) {
  const ctx = await (await import('esbuild')).context(options);
  await ctx.watch();
  console.log('watching src/ ...');
} else {
  await build(options);
  console.log(`built dist/flatmmo-market-plus.user.js (v${pkg.version})`);
}
