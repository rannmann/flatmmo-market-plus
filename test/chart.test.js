import { describe, it, expect } from 'vitest';
import { buildSparkline, toEpoch } from '../src/chart.js';
import { parseMarketUrl, isMarketUrl } from '../src/marketUrl.js';

describe('buildSparkline', () => {
  const series = [
    { x: 0, y: 10 },
    { x: 1, y: 20 },
    { x: 2, y: 15 },
  ];

  it('produces a line path starting with a move command', () => {
    const s = buildSparkline(series, { width: 100, height: 40, padding: 0 });
    expect(s.line.startsWith('M')).toBe(true);
    expect(s.line.split('L')).toHaveLength(3);
  });

  it('closes the area path back along the baseline', () => {
    const s = buildSparkline(series, { width: 100, height: 40, padding: 0 });
    expect(s.area.endsWith('Z')).toBe(true);
  });

  it('puts the highest value nearest the top', () => {
    const s = buildSparkline(
      [
        { x: 0, y: 0 },
        { x: 1, y: 100 },
      ],
      { width: 100, height: 40, padding: 0 }
    );
    // SVG y grows downward, so the peak has the smaller y.
    const [, first, second] = s.line.match(/M[\d.]+,([\d.]+) L[\d.]+,([\d.]+)/);
    expect(Number(second)).toBeLessThan(Number(first));
  });

  it('reports first and last for a trend readout', () => {
    const s = buildSparkline(series);
    expect(s).toMatchObject({ first: 10, last: 15, minY: 10, maxY: 20, count: 3 });
  });

  it('centres a flat series instead of dividing by zero', () => {
    const s = buildSparkline(
      [
        { x: 0, y: 5 },
        { x: 1, y: 5 },
      ],
      { width: 100, height: 40 }
    );
    expect(s.line).toMatch(/,20/);
    expect(s.line).not.toMatch(/NaN/);
  });

  it('drops points with no price rather than plotting them as zero', () => {
    // A period with no trades has no average; drawing it at 0 would invent a crash.
    const s = buildSparkline([
      { x: 0, y: 10 },
      { x: 1, y: null },
      { x: 2, y: 12 },
    ]);
    expect(s.count).toBe(2);
  });

  it('returns null when there is not enough to draw a line', () => {
    expect(buildSparkline([{ x: 0, y: 1 }])).toBeNull();
    expect(buildSparkline([])).toBeNull();
    expect(buildSparkline(null)).toBeNull();
  });
});

describe('toEpoch', () => {
  it('reads the API timestamp format as UTC', () => {
    expect(toEpoch('2026-09-04 14:55:14.072')).toBe(Date.parse('2026-09-04T14:55:14.072Z'));
  });

  it('accepts an ISO timestamp unchanged', () => {
    expect(toEpoch('2026-09-04T14:55:14Z')).toBe(Date.parse('2026-09-04T14:55:14Z'));
  });

  it('returns null for junk', () => {
    expect(toEpoch('not a date')).toBeNull();
    expect(toEpoch(null)).toBeNull();
  });
});

describe('parseMarketUrl', () => {
  it('recognises a single item listing', () => {
    expect(parseMarketUrl('https://market.flatmmo.com/market/listing/stardust/view/')).toEqual({
      kind: 'item',
      item: 'stardust',
    });
  });

  it('treats "all" as the whole-market view, not an item', () => {
    expect(parseMarketUrl('https://market.flatmmo.com/market/listing/all/view/')).toEqual({
      kind: 'all',
    });
  });

  it('tolerates a missing trailing slash', () => {
    expect(parseMarketUrl('https://market.flatmmo.com/market/listing/ashes/view')).toMatchObject({
      item: 'ashes',
    });
  });

  it('ignores unrelated URLs so normal links still work', () => {
    expect(parseMarketUrl('https://flatmmo.com/play.php')).toBeNull();
    expect(parseMarketUrl('https://evil.example.com/market/listing/x/view/')).toBeNull();
    expect(parseMarketUrl(null)).toBeNull();
  });

  it('isMarketUrl agrees', () => {
    expect(isMarketUrl('https://market.flatmmo.com/market/listing/all/view/')).toBe(true);
    expect(isMarketUrl('https://flatmmo.com/')).toBe(false);
  });
});
