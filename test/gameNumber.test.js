import { describe, it, expect } from 'vitest';
import { parseGameNumber, describeInputProblem } from '../src/gameNumber.js';

describe('parseGameNumber', () => {
  it('reads plain digits', () => {
    expect(parseGameNumber('1000')).toBe(1000);
  });

  it('applies the k and m suffixes', () => {
    expect(parseGameNumber('10k')).toBe(10_000);
    expect(parseGameNumber('1.5m')).toBe(1_500_000);
  });

  it('is case- and whitespace-insensitive', () => {
    expect(parseGameNumber('  10K  ')).toBe(10_000);
  });

  it('reproduces the b-suffix bug rather than fixing it', () => {
    // The game's regex allows `b` but its multiplier table does not define it,
    // so the multiplication yields NaN and the game posts "NaN".
    expect(parseGameNumber('1b')).toBeNaN();
  });

  it('rejects thousands separators, as the game does', () => {
    expect(parseGameNumber('10,000')).toBeNaN();
  });

  it('rejects negatives and junk', () => {
    expect(parseGameNumber('-5')).toBeNaN();
    expect(parseGameNumber('abc')).toBeNaN();
    expect(parseGameNumber('')).toBeNaN();
    expect(parseGameNumber(null)).toBeNaN();
  });

  it('passes fractional values through unrounded, as the game does', () => {
    expect(parseGameNumber('1.5')).toBe(1.5);
  });
});

describe('describeInputProblem', () => {
  it('stays quiet on empty input', () => {
    expect(describeInputProblem('')).toBeNull();
    expect(describeInputProblem('   ')).toBeNull();
  });

  it('stays quiet on valid input', () => {
    expect(describeInputProblem('10k')).toBeNull();
    expect(describeInputProblem('250')).toBeNull();
  });

  it('calls out the b suffix specifically', () => {
    expect(describeInputProblem('1b')).toMatch(/"b" suffix/);
  });

  it('calls out separators specifically', () => {
    expect(describeInputProblem('10,000')).toMatch(/separators/i);
  });

  it('calls out fractional quantities', () => {
    expect(describeInputProblem('1.5')).toMatch(/whole number/i);
  });

  it('falls back to a general message', () => {
    expect(describeInputProblem('abc')).toMatch(/cannot read/i);
  });
});
