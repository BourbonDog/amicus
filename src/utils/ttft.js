/**
 * @module utils/ttft
 * The one honesty predicate for the time-to-first-token probe (v4.9 W13).
 *
 * ⚠️ The JSDoc leads this file, ahead of `'use strict'`, matching
 * `utils/text-sanitize.js` / `utils/engine-skew.js` / `utils/alias-shadow.js`:
 * `scripts/generate-docs.js` only reads a block comment that starts at byte
 * zero, so a `// path` line above it would leave this module's CLAUDE.md row
 * blank the way `utils/result-schema.js`'s already is.
 *
 * `ttftMs` is produced once — in `src/headless.js`'s poll loop, as a
 * `Date.now()` delta — and then passes five EMIT GATES on its way to a
 * document: `headless.js`'s three returns, `sidecar/fanout-leg.js`'s leg patch,
 * `utils/result-schema.js :: buildRunResult`,
 * `council/run-stats-entry.js :: buildRunStatsEntry`, and
 * `council/tally.js :: tally`'s runStats re-projection. Every gate used to spell
 * its own `typeof x === 'number'` test, which is five chances to disagree and
 * five ways to publish a value both schemas forbid.
 *
 * ⚠️ The fifth gate is different in KIND from the four above it, which is why it
 * was missed for a release (#202). Those four are PRODUCERS — each writes the
 * field onto a document it is building. `tally.js` is a RE-PROJECTION: it copies
 * an already-built row through a hand-maintained allowlist, so omitting the field
 * there does not fail to produce it, it DESTROYS one already produced. Between
 * v4.9.0 and v4.9.1 that is exactly what happened — the probe wrote real values
 * into tally-input.json and every one was stripped before tally.json and
 * verdict.json, the only run artifacts CI uploads (MEASURED, run 33030485388:
 * 11 of 12 rows carried it going in, 0 of 12 coming out).
 *
 * ⚠️ `typeof` is not the schema's contract. `schemas/run.schema.json` and
 * `schemas/council-tally.schema.json` both declare this field
 * `integer, minimum 0`, and `typeof` admits four families that violate it:
 *   · NaN — `JSON.stringify` writes it as `null`, so the artifact breaks its own
 *     schema while LOOKING like the honest absence the emit-when-set rule means.
 *   · ±Infinity — not hypothetical from an artifact: `JSON.parse('1e999')` is
 *     `Infinity` (MEASURED), and it also serializes to `null`.
 *   · Negative — the probe is a wall-clock delta, so a backward jump (NTP
 *     correction, a VM resuming from suspend, a manual clock set) between the
 *     clock origin and the first substantive poll measures below zero.
 *   · Fractional — a hand-edited leg document.
 *
 * ⚠️ DROP, DO NOT CLAMP. A skewed −5 s reading clamped to `0` would publish
 * "first token inside the first poll" — the most consequential value in the
 * distribution the C2 derivation will read — for a leg that measured nothing of
 * the kind. Emit-when-VALID is the same discipline as emit-when-set: absence
 * already means "no honest measurement was made", and a dishonest number is
 * exactly that. `0` itself stays a real, emittable measurement.
 *
 * ⚠️ Four of the five gates import this. The one that does not,
 * `council/run-stats-entry.js`, is pinned REQUIRE-FREE (P3,
 * tests/council/run-stats-entry.test.js — the pin fires on the character
 * sequence anywhere in that file, comments included) so require-free consumers
 * can import it, so it spells the same expression by hand. The structural pins
 * that keep the hand-spelled copy in step live in that same test file.
 */

'use strict';

/**
 * Is this a real time-to-first-token measurement, fit to ride a document?
 * @param {*} value
 * @returns {boolean} true only for a non-negative integer millisecond count.
 */
function isMeasuredTtft(value) {
  return Number.isInteger(value) && value >= 0;
}

module.exports = { isMeasuredTtft };
