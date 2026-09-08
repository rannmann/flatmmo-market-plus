/**
 * A faithful mirror of the game's own parseNumberInput().
 *
 * The plugin must agree with the game about what a typed value means, or the
 * cost it displays would not be the cost that gets posted. So this reproduces
 * the original exactly -- including its faults, which are then reported to the
 * player rather than silently corrected:
 *
 *  - The regex accepts a `b` suffix but the multiplier table only defines `k`
 *    and `m`, so "1b" multiplies by undefined and yields NaN. The game posts
 *    that NaN straight to the server.
 *  - Nothing rounds, so "1.5" is accepted as a quantity of 1.5.
 *  - Separators are rejected outright: "10,000" is NaN, not 10000.
 */

const MULTIPLIERS = { k: 1_000, m: 1_000_000 };

/** Exactly what the game would compute for this input. NaN where it gets NaN. */
export function parseGameNumber(str) {
  if (typeof str !== 'string') return NaN;
  const s = str.trim().toLowerCase();
  const match = s.match(/^(\d+(\.\d+)?)([kmb])?$/);
  if (!match) return NaN;
  let value = Number.parseFloat(match[1]);
  const suffix = match[3];
  if (suffix) value *= MULTIPLIERS[suffix];
  return value;
}

/**
 * Why an input will not post cleanly, or null when it is fine.
 * Empty input returns null: it is incomplete, not wrong, and flagging it while
 * the player is still typing would be noise.
 */
export function describeInputProblem(str) {
  if (typeof str !== 'string' || str.trim() === '') return null;
  const s = str.trim().toLowerCase();

  if (/^(\d+(\.\d+)?)b$/.test(s)) {
    return 'The game does not understand the "b" suffix and will post NaN. Type the digits out.';
  }
  const value = parseGameNumber(s);
  if (Number.isNaN(value)) {
    if (/[,\s]/.test(s)) return 'Separators are not accepted here. Try 10000 or 10k.';
    return 'The game cannot read this. Use digits, optionally with a k or m suffix.';
  }
  if (!Number.isInteger(value)) {
    return `This is not a whole number (${value}).`;
  }
  return null;
}
