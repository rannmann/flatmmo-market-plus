import { describe, it, expect } from 'vitest';
import { parseFrame, parseItemSelected, parsePostings } from '../src/protocol.js';

describe('parseFrame', () => {
  it('splits command from tilde-separated values', () => {
    expect(parseFrame('FOO=a~b~c')).toEqual({ command: 'FOO', values: ['a', 'b', 'c'] });
  });

  it('handles a command with no values', () => {
    expect(parseFrame('OPEN_MARKET_UI=')).toEqual({ command: 'OPEN_MARKET_UI', values: [] });
  });

  it('keeps later equals signs inside the value', () => {
    expect(parseFrame('CHAT=a=b')).toEqual({ command: 'CHAT', values: ['a=b'] });
  });

  it('rejects non-frames', () => {
    expect(parseFrame('no equals sign')).toBeNull();
    expect(parseFrame('=leading')).toBeNull();
    expect(parseFrame(null)).toBeNull();
    expect(parseFrame(undefined)).toBeNull();
  });
});

describe('parseItemSelected', () => {
  it('reads item, bank stock and coins', () => {
    expect(parseItemSelected(['stardust', '14687', '250000'])).toEqual({
      item: 'stardust',
      bankAmount: 14_687,
      coins: 250_000,
    });
  });

  it('accepts a zero bank stock', () => {
    expect(parseItemSelected(['ashes', '0', '10'])).toEqual({
      item: 'ashes',
      bankAmount: 0,
      coins: 10,
    });
  });

  it('rejects malformed payloads instead of yielding NaN', () => {
    expect(parseItemSelected(['stardust', 'abc', '1'])).toBeNull();
    expect(parseItemSelected(['stardust', '1'])).toBeNull();
    expect(parseItemSelected([])).toBeNull();
    expect(parseItemSelected(null)).toBeNull();
  });
});

describe('parsePostings', () => {
  const one = [
    '1', 'stardust', '11', '14687', '0', '0', 'active',
    '2026-09-07T13:41:49', 'sell', 'uuid-1', '0',
  ];
  const two = [
    '2', 'unpowered_orb', '83', '67451', '100', '8300', 'active',
    '2026-09-07T13:39:40', 'sell', 'uuid-2', '0',
  ];

  it('returns nothing for the "none" sentinel', () => {
    expect(parsePostings(['none'])).toEqual([]);
  });

  it('parses a single listing with numeric fields coerced', () => {
    const [posting] = parsePostings(one);
    expect(posting).toMatchObject({
      itemName: 'stardust',
      price: 11,
      amount: 14_687,
      amountSold: 0,
      direction: 'sell',
      uuid: 'uuid-1',
    });
  });

  it('parses several listings back to back', () => {
    const postings = parsePostings([...one, ...two]);
    expect(postings).toHaveLength(2);
    expect(postings[1]).toMatchObject({ itemName: 'unpowered_orb', price: 83, toCollect: 8300 });
  });

  it('drops a trailing partial group rather than emitting a half-filled listing', () => {
    const postings = parsePostings([...one, '3', 'ashes', '220']);
    expect(postings).toHaveLength(1);
    expect(postings[0].itemName).toBe('stardust');
  });

  it('returns nothing for empty or missing input', () => {
    expect(parsePostings([])).toEqual([]);
    expect(parsePostings(null)).toEqual([]);
  });
});
