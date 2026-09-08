import { describe, it, expect } from 'vitest';
import { parsePostingLine, extractUuid } from '../src/domPostings.js';
import { createOrderTracker } from '../src/orders.js';

const UUID = '15faf028-c1b9-4aad-a4e4-747f879e550d';

describe('extractUuid', () => {
  it('reads the uuid from either handler', () => {
    expect(extractUuid([`cancel_market_offer("${UUID}")`])).toBe(UUID);
    expect(extractUuid([`collect_market_offer("${UUID}")`])).toBe(UUID);
  });

  it('ignores unrelated handlers', () => {
    expect(extractUuid(['window.open("https://market.flatmmo.com/x/view/","_blank")'])).toBeNull();
    expect(extractUuid([])).toBeNull();
    expect(extractUuid(null)).toBeNull();
  });
});

describe('parsePostingLine', () => {
  it('reads a sell listing', () => {
    expect(parsePostingLine({
      itemName: 'stardust',
      uuid: UUID,
      text: 'sell Stardust 2026-09-07 13:41:49 27/14687 sold 11 each 0 coins to collect open_in_new cancel',
    })).toEqual({
      uuid: UUID, itemName: 'stardust', price: 11, amount: 14_687,
      amountSold: 27, direction: 'sell', createdAt: '2026-09-07 13:41:49',
    });
  });

  it('reads a buy listing from the "bought" wording', () => {
    const o = parsePostingLine({
      itemName: 'unpowered_orb',
      uuid: UUID,
      text: 'buy Unpowered Orb 2026-09-08 10:38:32 0/69194 bought 81 each 0 unpowered_orb to collect',
    });
    expect(o).toMatchObject({ direction: 'buy', amount: 69_194, amountSold: 0, price: 81 });
  });

  it('handles comma-formatted numbers', () => {
    const o = parsePostingLine({
      itemName: 'a', uuid: UUID, text: 'sell A 2026-01-01 00:00:00 1,200/56,378 sold 1,049 each',
    });
    expect(o).toMatchObject({ amountSold: 1_200, amount: 56_378, price: 1_049 });
  });

  it('rejects listings missing what it needs', () => {
    expect(parsePostingLine({ itemName: 'a', uuid: UUID, text: 'nothing useful' })).toBeNull();
    expect(parsePostingLine({ itemName: '', uuid: UUID, text: '1/2 sold 3 each' })).toBeNull();
    expect(parsePostingLine({ itemName: 'a', uuid: null, text: '1/2 sold 3 each' })).toBeNull();
  });
});

describe('recovered orders in the tracker', () => {
  const recovered = () => parsePostingLine({
    itemName: 'stardust', uuid: UUID,
    text: 'sell Stardust 2026-09-07 13:41:49 27/14687 sold 11 each',
  });

  it('produces a usable remaining figure straight away', () => {
    const t = createOrderTracker({ storage: null });
    t.observe([recovered()]);
    expect(t.remainingAt({ itemName: 'stardust', direction: 'sell', price: 11 })).toBe(14_660);
  });

  it('is superseded normally by a later live frame', () => {
    const t = createOrderTracker({ storage: null });
    t.observe([recovered()]);
    t.observe([{ ...recovered(), amountSold: 500 }]);
    expect(t.remainingAt({ itemName: 'stardust', direction: 'sell', price: 11 })).toBe(14_187);
  });
});
