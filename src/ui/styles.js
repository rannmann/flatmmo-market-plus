/**
 * Styles for everything this plugin injects.
 *
 * Written to sit inside the game's own dark modals without looking bolted on,
 * and scoped under a single prefix so nothing here can leak into game UI.
 */

export const PREFIX = 'fmpm';

/**
 * The posting modal is a LIGHT surface (the game renders it near-white), while
 * the Global Market panel behind it is dark. These rules target the posting
 * modal, so the palette is dark-on-light. Anything added to the market panel
 * later needs its own colours rather than reusing these.
 */
export const CSS = `
.${PREFIX}-panel {
  margin: 10px 0;
  padding: 8px 10px;
  border: 1px solid #c9c9c9;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.035);
  font-size: 0.85rem;
  line-height: 1.5;
  color: #1f1f1f;
  text-align: left;
}
.${PREFIX}-row { display: flex; justify-content: space-between; gap: 12px; }
.${PREFIX}-row + .${PREFIX}-row { margin-top: 3px; }
.${PREFIX}-label { color: #5c5c5c; }
.${PREFIX}-value { font-variant-numeric: tabular-nums; white-space: nowrap; font-weight: 600; }
.${PREFIX}-good { color: #1a7f37; }
.${PREFIX}-warn { color: #8a6100; }
.${PREFIX}-bad { color: #b42318; }
.${PREFIX}-muted { color: #5c5c5c; font-weight: 400; }

.${PREFIX}-btn {
  display: inline-block;
  padding: 2px 10px;
  margin-left: 6px;
  border: 1px solid #3a3a3a;
  border-radius: 4px;
  background: #333;
  color: #f0f0f0;
  font-size: 0.78rem;
  cursor: pointer;
  user-select: none;
  vertical-align: middle;
}
.${PREFIX}-btn:hover { background: #4a4a4a; }
.${PREFIX}-btn[aria-disabled="true"] { opacity: 0.35; cursor: default; }
.${PREFIX}-btn[aria-disabled="true"]:hover { background: #333; }

.${PREFIX}-heading {
  margin: 8px 0 4px;
  padding-top: 6px;
  border-top: 1px solid #d0d0d0;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: #6a6a6a;
}

.${PREFIX}-problem {
  margin-top: 6px;
  padding: 5px 8px;
  border-left: 3px solid #d9a400;
  background: rgba(217, 164, 0, 0.12);
  color: #6b4d00;
  font-size: 0.8rem;
}

.${PREFIX}-spark { display: block; width: 100%; height: 40px; margin-top: 6px; }
.${PREFIX}-spark-line { fill: none; stroke: #1a7f37; stroke-width: 1.5; }
.${PREFIX}-spark-area { fill: rgba(26, 127, 55, 0.12); stroke: none; }

/* --- Typeahead: sits inside the light posting modal --- */
.${PREFIX}-ta {
  position: fixed;
  z-index: 10060;
  min-width: 240px;
  max-height: 260px;
  overflow-y: auto;
  border: 1px solid #b9b9b9;
  border-radius: 6px;
  background: #fff;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.22);
  text-align: left;
}
.${PREFIX}-ta-row {
  display: flex; align-items: center; gap: 8px;
  padding: 5px 8px; cursor: pointer; font-size: 0.85rem; color: #1f1f1f;
}
.${PREFIX}-ta-row:hover, .${PREFIX}-ta-active { background: #e8f0fe; }
.${PREFIX}-ta-icon { width: 20px; height: 20px; object-fit: contain; flex: none; }
.${PREFIX}-ta-name { flex: 1; }
.${PREFIX}-ta-raw { color: #8a8a8a; font-size: 0.75rem; }

/* --- Market browser: a dark sheet over the game --- */
.${PREFIX}-overlay {
  position: fixed; inset: 0; z-index: 10040;
  display: flex; align-items: center; justify-content: center;
  background: rgba(0, 0, 0, 0.6);
}
.${PREFIX}-sheet {
  width: min(760px, 94vw); max-height: 88vh;
  display: flex; flex-direction: column;
  border: 1px solid #3a3a3a; border-radius: 8px;
  background: #1c1c1c; color: #e6e6e6;
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.55);
}
.${PREFIX}-sheet-head {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 14px; border-bottom: 1px solid #333;
}
.${PREFIX}-sheet-title { flex: 1; font-size: 1.05rem; font-weight: 700; }
.${PREFIX}-sheet-close { cursor: pointer; font-size: 1.4rem; line-height: 1; color: #b9b9b9; }
.${PREFIX}-sheet-close:hover { color: #fff; }
.${PREFIX}-sheet-body { padding: 12px 14px; overflow-y: auto; }
.${PREFIX}-loading { padding: 24px 0; text-align: center; color: #9a9a9a; }

.${PREFIX}-strip { display: flex; flex-wrap: wrap; gap: 14px; margin-bottom: 12px; }
.${PREFIX}-strip-cell {
  flex: 1 1 110px; padding: 7px 10px;
  border: 1px solid #333; border-radius: 6px; background: #232323;
}
.${PREFIX}-strip-label { font-size: 0.72rem; color: #9a9a9a; text-transform: uppercase; }
.${PREFIX}-strip-value { font-size: 1rem; font-weight: 700; font-variant-numeric: tabular-nums; }

.${PREFIX}-chart { margin: 6px 0 14px; }
.${PREFIX}-chart-caption { font-size: 0.75rem; color: #9a9a9a; margin-bottom: 4px; }
.${PREFIX}-sheet .${PREFIX}-spark { height: 70px; }
.${PREFIX}-sheet .${PREFIX}-spark-line { stroke: #8ce99a; }
.${PREFIX}-sheet .${PREFIX}-spark-area { fill: rgba(140, 233, 154, 0.14); }

.${PREFIX}-ladders { display: flex; flex-wrap: wrap; gap: 14px; }
.${PREFIX}-ladder { flex: 1 1 260px; margin-bottom: 14px; }
.${PREFIX}-ladder-title {
  font-size: 0.78rem; text-transform: uppercase; color: #9a9a9a; margin-bottom: 4px;
}
.${PREFIX}-table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
.${PREFIX}-table th {
  text-align: right; padding: 4px 6px; border-bottom: 1px solid #383838;
  color: #9a9a9a; font-weight: 600;
}
.${PREFIX}-table th:first-child, .${PREFIX}-table td:first-child { text-align: left; }
.${PREFIX}-table td {
  text-align: right; padding: 4px 6px;
  border-bottom: 1px solid #2a2a2a; font-variant-numeric: tabular-nums;
}
.${PREFIX}-table td:first-child { display: flex; align-items: center; gap: 7px; }
.${PREFIX}-sheet .${PREFIX}-good { color: #8ce99a; }
.${PREFIX}-sheet .${PREFIX}-bad { color: #ff9b8e; }
.${PREFIX}-sheet .${PREFIX}-muted { color: #8a8a8a; }
.${PREFIX}-row-click { cursor: pointer; }

/* A price level containing the player's own resting orders. */
.${PREFIX}-mine td { background: rgba(140, 233, 154, 0.09); }
.${PREFIX}-mine td:first-child { box-shadow: inset 3px 0 0 #8ce99a; }
.${PREFIX}-tag {
  display: inline-block;
  margin-left: 6px;
  padding: 0 5px;
  border-radius: 3px;
  background: #8ce99a;
  color: #10240f;
  font-size: 0.68rem;
  font-weight: 700;
  vertical-align: middle;
  white-space: nowrap;
}
.${PREFIX}-table-hover tbody tr:hover { background: #262626; }

.${PREFIX}-controls { display: flex; gap: 8px; margin-bottom: 10px; }
.${PREFIX}-filter, .${PREFIX}-sort {
  padding: 5px 8px; border: 1px solid #3d3d3d; border-radius: 5px;
  background: #262626; color: #e6e6e6; font-size: 0.85rem;
}
.${PREFIX}-filter { flex: 1; }
`;


/**
 * Inject the stylesheet once.
 * Kept on `@grant none` deliberately, so a plain <style> element rather than
 * GM_addStyle -- see the note in flatstats.js about the Tampermonkey sandbox.
 */
export function ensureStyles(doc = document) {
  const id = `${PREFIX}-styles`;
  if (doc.getElementById(id)) return;
  const style = doc.createElement('style');
  style.id = id;
  style.textContent = CSS;
  doc.head.appendChild(style);
}
