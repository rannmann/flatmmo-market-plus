import { describe, it, expect, vi } from 'vitest';
import { installMarketInterception } from '../src/ui/intercept.js';

/** Minimal document stand-in that records the capture-phase click listener. */
function fakeDoc() {
  let handler = null;
  return {
    addEventListener: (type, fn, capture) => {
      if (type === 'click' && capture) handler = fn;
    },
    removeEventListener: () => {
      handler = null;
    },
    click(href) {
      const event = {
        target: { closest: (sel) => (sel === 'a[href]' && href ? { getAttribute: () => href } : null) },
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      };
      handler?.(event);
      return event;
    },
    get hasHandler() {
      return handler !== null;
    },
  };
}

describe('installMarketInterception', () => {
  it('diverts a market listing window.open and does not navigate', () => {
    const onOpen = vi.fn();
    const originalOpen = vi.fn();
    const target = { open: originalOpen };
    installMarketInterception({ target, doc: fakeDoc(), onOpen });

    const result = target.open('https://market.flatmmo.com/market/listing/stardust/view/', '_blank');
    expect(onOpen).toHaveBeenCalledWith({ kind: 'item', item: 'stardust' });
    expect(originalOpen).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it('diverts the whole-market link', () => {
    const onOpen = vi.fn();
    const target = { open: vi.fn() };
    installMarketInterception({ target, doc: fakeDoc(), onOpen });
    target.open('https://market.flatmmo.com/market/listing/all/view/', '_blank');
    expect(onOpen).toHaveBeenCalledWith({ kind: 'all' });
  });

  it('leaves unrelated window.open calls alone', () => {
    const onOpen = vi.fn();
    const originalOpen = vi.fn(() => 'window');
    const target = { open: originalOpen };
    installMarketInterception({ target, doc: fakeDoc(), onOpen });

    const result = target.open('https://flatmmo.com/hiscores.php', '_blank');
    expect(onOpen).not.toHaveBeenCalled();
    expect(originalOpen).toHaveBeenCalled();
    expect(result).toBe('window');
  });

  it('diverts a market anchor click and suppresses the navigation', () => {
    const onOpen = vi.fn();
    const doc = fakeDoc();
    installMarketInterception({ target: { open: vi.fn() }, doc, onOpen });

    const event = doc.click('https://market.flatmmo.com/market/listing/ashes/view/');
    expect(onOpen).toHaveBeenCalledWith({ kind: 'item', item: 'ashes' });
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('leaves other links clickable', () => {
    const onOpen = vi.fn();
    const doc = fakeDoc();
    installMarketInterception({ target: { open: vi.fn() }, doc, onOpen });

    const event = doc.click('https://flatmmo.com/wiki');
    expect(onOpen).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('ignores clicks that are not on a link', () => {
    const onOpen = vi.fn();
    const doc = fakeDoc();
    installMarketInterception({ target: { open: vi.fn() }, doc, onOpen });
    doc.click(null);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('restores the original window.open on uninstall', () => {
    const originalOpen = vi.fn();
    const target = { open: originalOpen };
    const doc = fakeDoc();
    const handle = installMarketInterception({ target, doc, onOpen: vi.fn() });
    handle.uninstall();
    expect(target.open).toBe(originalOpen);
    expect(doc.hasHandler).toBe(false);
  });
});
