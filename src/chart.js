/**
 * Sparkline geometry.
 *
 * Kept free of the DOM so the path maths can be tested directly; the caller
 * turns the returned strings into an <svg>.
 */

/**
 * Project a series onto a box and return SVG path data.
 *
 * `series` is an array of `{ x, y }` where x is any increasing numeric scale
 * (a timestamp, typically). Points whose y is null are dropped rather than
 * plotted as zero -- a period with no trades has no price, and drawing it at
 * the axis would invent a crash that never happened.
 *
 * Returns null when fewer than two points survive, since a single point is not
 * a line and stretching it across the box would imply a trend.
 */
export function buildSparkline(series, { width = 280, height = 40, padding = 2 } = {}) {
  const points = (Array.isArray(series) ? series : []).filter(
    (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y)
  );
  if (points.length < 2) return null;

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const spanX = maxX - minX || 1;
  // A flat series has zero range; centring it avoids a divide-by-zero and is
  // more honest than pinning the line to the top or bottom edge.
  const spanY = maxY - minY;
  const innerH = height - padding * 2;

  const projected = points.map((p) => ({
    px: padding + ((p.x - minX) / spanX) * (width - padding * 2),
    py: spanY === 0 ? height / 2 : padding + innerH - ((p.y - minY) / spanY) * innerH,
  }));

  const line = projected
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${round(p.px)},${round(p.py)}`)
    .join(' ');

  const area =
    `${line} L${round(projected[projected.length - 1].px)},${height - padding}` +
    ` L${round(projected[0].px)},${height - padding} Z`;

  return { line, area, minY, maxY, first: ys[0], last: ys[ys.length - 1], count: points.length };
}

/** Parse an API timestamp into epoch ms, or null if unusable. */
export function toEpoch(value) {
  if (typeof value !== 'string' || !value) return null;
  // API timestamps are UTC but written without a zone ("2026-09-04 14:55:14.072").
  const normalised = value.includes('T') ? value : value.replace(' ', 'T') + 'Z';
  const ms = Date.parse(normalised);
  return Number.isNaN(ms) ? null : ms;
}

function round(n) {
  return Math.round(n * 10) / 10;
}
