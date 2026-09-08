import { describe, it, expect } from 'vitest';
import { parseHistoryLine } from '../src/domHistory.js';
import { createLedger } from '../src/ledger.js';
import { parseHistory } from '../src/protocol.js';

describe('parseHistoryLine', () => {
  it('reads a rendered sale', () => {
    expect(parseHistoryLine('unpowered_orb', '25 Unpowered Orb sold for 2,075 coins 2026-09-08')).toEqual({
      itemName: 'unpowered_orb',
      price: 83,
      amount: 25,
      tax: 0,
      direction: 'sell',
      completedAt: '2026-09-08',
      provisional: true,
    });
  });

  it('reads a rendered purchase', () => {
    const e = parseHistoryLine('stardust', '100 Stardust bought for 600 coins 2026-09-08');
    expect(e).toMatchObject({ direction: 'buy', price: 6, amount: 100 });
  });

  it('handles large comma-formatted numbers', () => {
    const e = parseHistoryLine('unpowered_orb', '56,378 Unpowered Orb sold for 5,017,642 coins 2026-08-13');
    expect(e).toMatchObject({ amount: 56_378, price: 89 });
  });

  it('always marks entries provisional, since tax is not rendered', () => {
    expect(parseHistoryLine('a', '1 A sold for 7 coins 2026-06-12').provisional).toBe(true);
  });

  it('tolerates a missing date rather than dropping the trade', () => {
    expect(parseHistoryLine('a', '5 A sold for 50 coins')).toMatchObject({ completedAt: '' });
  });

  it('rejects unparseable lines', () => {
    expect(parseHistoryLine('a', 'No transactions have been made yet.')).toBeNull();
    expect(parseHistoryLine('', '25 A sold for 100 coins')).toBeNull();
    expect(parseHistoryLine('a', null)).toBeNull();
  });

  it('rejects a zero amount rather than dividing by it', () => {
    expect(parseHistoryLine('a', '0 A sold for 100 coins 2026-01-01')).toBeNull();
  });
});

describe('provisional entries in the ledger', () => {
  const line = '25 Unpowered Orb sold for 2,075 coins 2026-09-08';
  const frame = ['unpowered_orb', '83', '25', '17', 'sell', '2026-09-08'];

  it('records a recovered entry when nothing better exists', () => {
    const ledger = createLedger({ storage: null });
    expect(ledger.record([parseHistoryLine('unpowered_orb', line)])).toBe(1);
    expect(ledger.summaryFor('unpowered_orb').soldUnits).toBe(25);
  });

  it('lets a real frame replace the recovered entry, recovering the tax', () => {
    const ledger = createLedger({ storage: null });
    ledger.record([parseHistoryLine('unpowered_orb', line)]);
    expect(ledger.summaryFor('unpowered_orb').soldTax).toBe(0);

    expect(ledger.record(parseHistory(frame))).toBe(1);
    expect(ledger.summaryFor('unpowered_orb').soldTax).toBe(17);
    // Same transaction, so it must not be counted twice.
    expect(ledger.tradesFor('unpowered_orb')).toHaveLength(1);
  });

  it('does not let a recovered entry overwrite real data', () => {
    const ledger = createLedger({ storage: null });
    ledger.record(parseHistory(frame));
    expect(ledger.record([parseHistoryLine('unpowered_orb', line)])).toBe(0);
    expect(ledger.summaryFor('unpowered_orb').soldTax).toBe(17);
  });

  it('re-seeding the same rendered rows adds nothing', () => {
    const ledger = createLedger({ storage: null });
    const entry = parseHistoryLine('unpowered_orb', line);
    ledger.record([entry]);
    expect(ledger.record([parseHistoryLine('unpowered_orb', line)])).toBe(0);
  });
});
