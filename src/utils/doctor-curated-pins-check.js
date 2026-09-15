/**
 * @module doctor-curated-pins-check
 * `doctor`'s `curated-pins` row ("Shipped pins", #238 Phase 2 follow-up).
 *
 * How many pins the package ships, the newest `verifiedOn` among them, and
 * how many sit behind the catalog CACHE — the same drift / newer-sibling
 * lines `models --check` prints (`sidecar/models.js ::
 * buildFallbackDriftReport`, §5-gated), computed from the cache only, never
 * a network call.
 *
 * In the amicus SOURCE CHECKOUT the row always carries the owner-mode command
 * — `node bin/amicus.js aliases --review --owner` is what resets the shipped
 * pins, and the owner asked for it to be one `doctor` away — as the hint when
 * pins are behind (status `warn`) and inside the message otherwise (`doctor`
 * prints hints only for non-ok rows). An installed copy cannot run owner mode,
 * so it gets the facts and no command, and stays `ok` even when pins lag: a
 * lagging shipped pin is not the user's to fix, and `models --check` carries
 * the per-pin detail. A missing cache, or a cache whose last refresh rejected
 * openrouter (`buildFallbackDriftReport`'s own §5 rule: it returns `[]` the
 * instant openrouter is among the rejected providers, since it cannot check
 * any route without that namespace), reports the pins and says drift is
 * unknown rather than silently reading that `[]` as "none behind".
 */

'use strict';

const ID = 'curated-pins';
const NAME = 'Shipped pins';
const OWNER_CMD = 'node bin/amicus.js aliases --review --owner';

/** @param {object} pins `loadCuratedPins().pins` @returns {string} the newest `verifiedOn` (ISO dates sort as strings), or '' */
function newestVerifiedOn(pins) {
  let best = '';
  for (const alias of Object.keys(pins)) {
    const v = pins[alias] && pins[alias].verifiedOn;
    if (typeof v === 'string' && v > best) { best = v; }
  }
  return best;
}

/**
 * @param {{loadCuratedPins: () => object, readCache: () => (object|null),
 *   buildFallbackDriftReport: (info: object) => string[], isSourceCheckout: () => boolean}} d
 * @returns {{id: string, name: string, status: 'ok'|'warn', message: string, hint: string|null}}
 */
function evaluateCuratedPins(d) {
  const { pins } = d.loadCuratedPins();
  const n = Object.keys(pins).length;
  const facts = `${n} pin${n === 1 ? '' : 's'}, verified up to ${newestVerifiedOn(pins) || 'unknown'}`;
  const cache = d.readCache();
  const cached = !!(cache && Array.isArray(cache.models) && cache.models.length > 0);
  const failures = cached && Array.isArray(cache.providerFailures) ? cache.providerFailures : [];
  // §5: buildFallbackDriftReport itself returns [] the instant openrouter is
  // rejected (it cannot check ANY route without that namespace) — reading
  // that as "none behind" would be the exact correct-but-silent degrade the
  // product principle forbids. Treat it like no cache at all: never call it,
  // and say drift is unknown, not zero.
  const orRejected = failures.some(f => f && f.provider === 'openrouter');
  const behind = (cached && !orRejected)
    ? d.buildFallbackDriftReport({ models: cache.models, providerFailures: failures }).length
    : 0;
  const drift = !cached ? ' (catalog not cached — drift unknown)'
    : orRejected ? ' (openrouter rows rejected at the last refresh — drift unknown)'
    : (behind > 0 ? `; ${behind} behind the catalog` : ', none behind the catalog');
  if (!d.isSourceCheckout()) {
    const tail = behind > 0 ? ' — a newer amicus will move them' : '';
    return { id: ID, name: NAME, status: 'ok', message: `${facts}${drift}${tail}`, hint: null };
  }
  if (behind > 0) {
    return { id: ID, name: NAME, status: 'warn', message: `${facts}${drift}`, hint: `${OWNER_CMD}  — resets the shipped pins; then commit src/utils/curated-pins.json` };
  }
  return { id: ID, name: NAME, status: 'ok', message: `${facts}${drift} — reset with: ${OWNER_CMD}`, hint: null };
}

module.exports = { evaluateCuratedPins };
