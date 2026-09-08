/**
 * Ranking for the item typeahead.
 *
 * The stock game UI offers a browser <datalist> over raw snake_case names, so
 * finding "Unpowered Orb" means knowing to type "unpowered_orb" and that a
 * datalist only matches from the start of the string. This ranks over display
 * names and matches anywhere, including across word boundaries ("uo" -> Unpowered Orb).
 */

const SCORE = {
  EXACT: 1000,
  PREFIX: 800,
  WORD_PREFIX: 600,
  SUBSTRING: 400,
  INITIALS: 300,
  SUBSEQUENCE: 100,
};

/**
 * Score one candidate against a query. Returns 0 for no match.
 * Shorter names win ties, so "Orb" outranks "Unpowered Orb" for the query "orb".
 */
export function scoreItem(query, item) {
  const q = normalise(query);
  if (!q) return 0;

  const display = normalise(item.displayName || item.name);
  const raw = normalise(item.name);
  let best = 0;

  for (const haystack of [display, raw]) {
    if (!haystack) continue;
    if (haystack === q) best = Math.max(best, SCORE.EXACT);
    else if (haystack.startsWith(q)) best = Math.max(best, SCORE.PREFIX);
    else if (wordStarts(haystack).some((w) => w.startsWith(q)))
      best = Math.max(best, SCORE.WORD_PREFIX);
    else if (haystack.includes(q)) best = Math.max(best, SCORE.SUBSTRING);
    else if (initials(haystack).startsWith(q)) best = Math.max(best, SCORE.INITIALS);
    else if (isSubsequence(q, haystack)) best = Math.max(best, SCORE.SUBSEQUENCE);
  }

  if (best === 0) return 0;
  // Tie-break toward shorter names without ever crossing into the band below.
  return best + Math.max(0, 99 - display.length);
}

/**
 * Rank `items` against `query`, best first.
 *
 * `allowed`, when given, restricts results to item names the game will actually
 * accept for a posting -- the plugin feeds it the game's own option list so the
 * typeahead can never offer something the server would reject.
 */
export function searchItems(query, items, { limit = 12, allowed = null } = {}) {
  if (!Array.isArray(items)) return [];
  const pool = allowed ? items.filter((i) => allowed.has(i.name)) : items;

  if (!normalise(query)) {
    return pool.slice(0, limit).map((item) => ({ item, score: 0 }));
  }

  const scored = [];
  for (const item of pool) {
    const score = scoreItem(query, item);
    if (score > 0) scored.push({ item, score });
  }
  scored.sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name));
  return scored.slice(0, limit);
}

/**
 * Lower-case, and flatten underscores to spaces so that a query typed in either
 * style ("unpowered_orb" or "Unpowered Orb") compares against a name stored in
 * either style. Both sides go through this, so the two notations are equivalent.
 */
function normalise(s) {
  if (typeof s !== 'string') return '';
  return s.toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
}

function wordStarts(s) {
  return s.split(/[\s_]+/).filter(Boolean);
}

function initials(s) {
  return wordStarts(s)
    .map((w) => w[0])
    .join('');
}

/** True when every character of `needle` appears in `haystack`, in order. */
export function isSubsequence(needle, haystack) {
  let i = 0;
  for (const ch of haystack) {
    if (ch === needle[i]) i++;
    if (i === needle.length) return true;
  }
  return needle.length === 0;
}
