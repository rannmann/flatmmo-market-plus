import { describe, it, expect, vi } from 'vitest';
import { waitForFlatMMOPlus, ensureFramework, boot } from '../src/index.js';

/** Minimal stand-ins for the framework globals. */
function fakeFramework() {
  const registered = [];
  class FlatMMOPlusPlugin {
    constructor(id, opts) {
      this.id = id;
      this.opts = opts;
      this.config = {};
    }
    getConfig(k) {
      return this.config[k];
    }
  }
  return {
    registered,
    FlatMMOPlusPlugin,
    FlatMMOPlus: { debug: false, registerPlugin: (p) => registered.push(p) },
  };
}

/** A clock that fires queued timers on demand, so tests never actually wait. */
function fakeClock() {
  let t = 0;
  const queue = [];
  return {
    now: () => t,
    setTimer: (fn, ms) => queue.push({ fn, at: t + ms }),
    advance(ms) {
      t += ms;
      const due = queue.splice(0, queue.length).filter((e) => e.at <= t);
      due.forEach((e) => e.fn());
    },
  };
}

describe('waitForFlatMMOPlus', () => {
  it('resolves immediately when the framework is already present', async () => {
    const fw = fakeFramework();
    const found = await waitForFlatMMOPlus(fw, { setTimer: () => {}, now: () => 0 });
    expect(found.FlatMMOPlus).toBe(fw.FlatMMOPlus);
  });

  it('resolves once the framework shows up later', async () => {
    const clock = fakeClock();
    const globals = {};
    const promise = waitForFlatMMOPlus(globals, {
      intervalMs: 100,
      timeoutMs: 5000,
      setTimer: clock.setTimer,
      now: clock.now,
    });

    // Framework arrives after the first poll misses.
    const fw = fakeFramework();
    Object.assign(globals, {
      FlatMMOPlus: fw.FlatMMOPlus,
      FlatMMOPlusPlugin: fw.FlatMMOPlusPlugin,
    });
    clock.advance(100);

    await expect(promise).resolves.toMatchObject({ FlatMMOPlus: fw.FlatMMOPlus });
  });

  it('gives up and resolves null past the timeout', async () => {
    const clock = fakeClock();
    const promise = waitForFlatMMOPlus(
      {},
      { intervalMs: 100, timeoutMs: 200, setTimer: clock.setTimer, now: clock.now }
    );
    clock.advance(100);
    clock.advance(100);
    await expect(promise).resolves.toBeNull();
  });

  it('waits for both globals, not just one', async () => {
    const clock = fakeClock();
    const globals = { FlatMMOPlus: {} }; // plugin base class not there yet
    const promise = waitForFlatMMOPlus(globals, {
      intervalMs: 100,
      timeoutMs: 200,
      setTimer: clock.setTimer,
      now: clock.now,
    });
    clock.advance(100);
    clock.advance(100);
    await expect(promise).resolves.toBeNull();
  });
});

describe('boot', () => {
  it('registers the plugin when the framework is present', async () => {
    const fw = fakeFramework();
    const plugin = await boot(fw, { setTimer: () => {}, now: () => 0 });
    expect(fw.registered).toHaveLength(1);
    expect(plugin.id).toBe('marketplus');
  });

  it('warns and registers nothing when the framework never appears', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const clock = fakeClock();
    const promise = boot(
      {},
      { waitMs: 100, loadWaitMs: 100, intervalMs: 50, setTimer: clock.setTimer, now: clock.now }
    );
    clock.advance(50);
    clock.advance(50);
    await Promise.resolve();
    clock.advance(50);
    clock.advance(50);
    await expect(promise).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('FlatMMO+ was not found'));
    warn.mockRestore();
  });
});

/** Document stand-in that records injected <script> tags. */
function fakeDoc() {
  const appended = [];
  const head = { appendChild: (el) => appended.push(el) };
  return {
    head,
    appended,
    createElement: () => ({ set src(v) { this._src = v; }, get src() { return this._src; } }),
  };
}

describe('ensureFramework', () => {
  it('uses the framework already on the page and injects nothing', async () => {
    const fw = fakeFramework();
    const doc = fakeDoc();
    const res = await ensureFramework(fw, { doc, setTimer: () => {}, now: () => 0 });
    expect(res.injected).toBe(false);
    expect(res.framework.FlatMMOPlus).toBe(fw.FlatMMOPlus);
    // The whole point: never load a second copy next to an existing one.
    expect(doc.appended).toHaveLength(0);
  });

  it('injects the framework only when nothing provided one', async () => {
    const clock = fakeClock();
    const globals = {};
    const doc = fakeDoc();
    const promise = ensureFramework(globals, {
      doc,
      waitMs: 200,
      loadWaitMs: 200,
      intervalMs: 100,
      setTimer: clock.setTimer,
      now: clock.now,
    });

    clock.advance(100);
    clock.advance(100); // initial wait expires -> injects

    await Promise.resolve();
    const fw = fakeFramework();
    Object.assign(globals, {
      FlatMMOPlus: fw.FlatMMOPlus,
      FlatMMOPlusPlugin: fw.FlatMMOPlusPlugin,
    });
    clock.advance(100);

    const res = await promise;
    expect(res.injected).toBe(true);
    expect(res.framework).not.toBeNull();
    expect(doc.appended).toHaveLength(1);
    expect(doc.appended[0].src).toMatch(/FlatMMOPlus\.js$/);
  });

  it('gives up when the injected framework never arrives', async () => {
    const clock = fakeClock();
    const doc = fakeDoc();
    const promise = ensureFramework(
      {},
      { doc, waitMs: 100, loadWaitMs: 100, intervalMs: 100, setTimer: clock.setTimer, now: clock.now }
    );
    clock.advance(100);
    await Promise.resolve();
    clock.advance(100);
    const res = await promise;
    expect(res.framework).toBeNull();
    expect(doc.appended).toHaveLength(1);
  });
});
