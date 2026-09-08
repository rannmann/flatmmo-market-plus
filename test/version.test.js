import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const distPath = new URL('../dist/flatmmo-market-plus.user.js', import.meta.url);

/**
 * The userscript's @version is what a script manager compares against to decide
 * whether an update exists, and the git tag is what a human matches it to. If
 * the built file lags package.json, a release ships without anyone being
 * offered the update -- silently, since nothing else would fail.
 */
describe('the built userscript version', () => {
  it('matches package.json', () => {
    if (!existsSync(distPath)) {
      throw new Error('dist is missing — run `npm run build` before releasing');
    }
    const banner = readFileSync(distPath, 'utf8').slice(0, 2000);
    const match = banner.match(/^\/\/ @version\s+(\S+)/m);
    expect(match, 'no @version line in the built banner').not.toBeNull();
    expect(match[1]).toBe(pkg.version);
  });

  it('is a plain semver, which script managers can order', () => {
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
