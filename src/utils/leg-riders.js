/**
 * @module leg-riders
 * The emit-when-set rider block every leg run document carries.
 *
 * ⚠️ The JSDoc leads this file, ahead of `'use strict'`, matching
 * `utils/ttft.js` / `utils/text-sanitize.js`: `scripts/generate-docs.js` only
 * reads a block comment that starts at byte zero, so the `'use strict'` line
 * that stood above this block left this module's architecture-map row blank —
 * the exact trap `utils/ttft.js`'s own header names.
 *
 * Extracted VERBATIM from result-schema.js :: buildRunResult (#257 — that file
 * sat at the 300-line gate and its last rider line already carried three
 * fields). Key ORDER is the contract for the LEG DOCUMENT: ttftMs, finish,
 * variant, variantUnverified, backstop, promoted — the order the wave
 * document has always written. The runStats ROW (council/run-stats-entry.js)
 * is a separate projection with its own order (there `promoted` rides after
 * `ttftMs` and before `usage`); neither order is the other's contract.
 * `promoted` (#257) is emit-when-true, like variantUnverified.
 */

'use strict';

const { isMeasuredTtft } = require('./ttft');
const { isBackstopRecord } = require('./no-output-backstop');

function legRiders(metadata = {}) {
  const m = metadata || {};
  return {
    // Moved VERBATIM with the gate it explains, from
    // `src/utils/result-schema.js@7e2fc83f:76-82` (#257); the "above" and
    // "below" it names are that file's neighbours, not this module's.
    // v4.9 W13 Task A (probe only, R12): time-to-first-token, sourced straight
    // off `metadata` like `opencodeSessionId` above. ADDITIVE and emit-when-set
    // (the pack/tag spread form below, not the `|| null` coercion above): an
    // absent ttft means "no substantive tick was observed", which is neither
    // zero nor null, so it must not be coerced into either. PR #207 round 3
    // (B3): emit-when-VALID via the shared predicate — `metadata` is read off
    // disk, so NaN/±Infinity/negatives/fractions all reach here. See ./ttft.js.
    ...(isMeasuredTtft(m.ttftMs) ? { ttftMs: m.ttftMs } : {}),
    ...(typeof m.finish === 'string' ? { finish: m.finish } : {}),
    ...(typeof m.variant === 'string' ? { variant: m.variant } : {}),
    ...(m.variantUnverified === true ? { variantUnverified: true } : {}),
    ...(isBackstopRecord(m.backstop) ? { backstop: m.backstop } : {}),
    ...(m.promoted === true ? { promoted: true } : {}),
  };
}

module.exports = { legRiders };
