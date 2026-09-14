/**
 * @module sidecar/aliases-review-render
 * Pure, side-effect-free screen text for `amicus aliases --review` (#238 §4),
 * split out of aliases-review.js (fix round 1) to keep that file under the
 * 300-line gate once the round's robustness fixes landed. Every export here
 * takes plain data and returns a string — no I/O, no config reads/writes, no
 * `ask`. `reasonPhrase` is an internal helper (only `renderScreen` calls it)
 * and is deliberately not exported, keeping this module's surface small.
 *
 * #249 r2 C4: every alias name, model id and catalog-sourced note this
 * module interpolates onto the screen rides `safeFragment` (the house
 * sanitizer, `utils/text-sanitize.js`) FIRST — the fragment, never the
 * composed line, per `alias-shadow.js :: formatAliasShadow`'s rule.
 */

'use strict';

const { DEFAULT_MAX_AGE_MS } = require('../utils/model-catalog');
const { safeFragment } = require('../utils/text-sanitize');

const LABEL_WIDTH = 11; // 'currently' / 'shipped' / 'proposed', each padded flush with the others

/** @returns {string} the reason phrase shown on the 'proposed' line for one candidate */
function reasonPhrase(c) {
  if (c.why === 'newer-sibling') { return 'newer sibling, same tier'; }
  if (c.why === 'replacement') { return 'replacement (current id is gone from the catalog)'; }
  if (c.why === 'follow') { return 'the shipped recommendation'; }
  return safeFragment(c.evidence && c.evidence.note) || 'notable model';
}

/**
 * @param {number} fetchedAt must be a number (callers gate on `isFresh`/
 *   `typeof` first — a missing cache gets its own banner, never this)
 * @param {number} now
 * @returns {string} e.g. '3 days' / '1 day' / '5 hours' / '1 hour'
 */
function ageLabel(fetchedAt, now) {
  const ms = now - fetchedAt;
  const days = Math.floor(ms / DEFAULT_MAX_AGE_MS);
  if (days >= 1) { return `${days} day${days === 1 ? '' : 's'}`; }
  const hours = Math.max(1, Math.floor(ms / 3600000));
  return `${hours} hour${hours === 1 ? '' : 's'}`;
}

/**
 * Minor (spec §4): "refreshing catalog (3 days old)…" -- printed BEFORE the
 * picker's own inline refresh, from the last cache on disk, so a stale-cache
 * wait reads as progress rather than a hang. Pure: takes the pre-refresh
 * `readCache()` doc and `now`, returns the line or null.
 * @param {{fetchedAt?: number}|null} cache
 * @param {number} now
 * @returns {string|null} the line (with trailing newline), or null when the
 *   cache is missing or not old enough to be worth naming
 */
function refreshingCatalogLine(cache, now) {
  if (!cache || typeof cache.fetchedAt !== 'number' || (now - cache.fetchedAt) <= DEFAULT_MAX_AGE_MS) { return null; }
  return `  refreshing catalog (${ageLabel(cache.fetchedAt, now)} old)…\n`;
}

/**
 * @param {object} p one proposal
 * @returns {Array<{label: string, action: 'accept'|'choose'|'skip'|'dismiss', candidate?: object}>}
 *   one entry per candidate in the engine's order (never re-sorted), then the
 *   three standing options
 */
function menuFor(p) {
  const alias = safeFragment(p.alias);
  const items = p.candidates.map(c => {
    const id = safeFragment(c.id);
    return {
      label: c.why === 'follow' ? `follow the shipped pin (${id})` : (c.why === 'notable' ? `add ${alias} → ${id}` : `accept ${id}`),
      action: 'accept',
      candidate: c,
    };
  });
  items.push({ label: 'choose another', action: 'choose' });
  items.push({ label: 'skip', action: 'skip' });
  items.push({ label: 'never ask again', action: 'dismiss' });
  return items;
}

/** @param {Array} items from `menuFor` @returns {string} the numbered menu line alone, no trailing newline */
function menuLineText(items) {
  return '    ' + items.map((it, idx) => `[${idx + 1}] ${it.label}`).join('   ');
}

/**
 * @param {object} p one proposal
 * @param {number} i zero-based index
 * @param {number} n total proposal count
 * @param {Array} items from `menuFor`
 * @returns {string} the full screen for one proposal — header, state block and menu — trailing newline included
 */
function renderScreen(p, i, n, items) {
  const lines = [`  [${i + 1}/${n}] ${safeFragment(p.alias)}`];
  lines.push(p.current
    ? `    ${'currently'.padEnd(LABEL_WIDTH)}${safeFragment(p.current)}      (pinned)`
    : '    not mapped yet');
  if (p.curated) { lines.push(`    ${'shipped'.padEnd(LABEL_WIDTH)}${safeFragment(p.shipped)}`); }
  const top = p.candidates[0];
  if (top) {
    lines.push(`    ${'proposed'.padEnd(LABEL_WIDTH)}${safeFragment(top.id)}   ${reasonPhrase(top)}`);
  } else if ((p.reasons || []).includes('stale')) {
    // F3: a stale pin with no same-vendor replacement and no sibling still
    // has something to say -- silently showing no reason at all read as the
    // engine finding nothing wrong, when what happened is the opposite.
    lines.push(`    ${'stale'.padEnd(LABEL_WIDTH)}current id is gone from the catalog — no same-vendor replacement found`);
  } else {
    lines.push(`    ${'reason'.padEnd(LABEL_WIDTH)}${(p.reasons || []).join(', ')}`);
  }
  lines.push('');
  lines.push(menuLineText(items));
  return lines.join('\n') + '\n';
}

module.exports = { ageLabel, menuFor, menuLineText, renderScreen, refreshingCatalogLine };
