/**
 * @module council/run-retry-window
 * The Stage-1 retry's no-output window: how long a RELAUNCHED leg may stay
 * silent before the backstop kills it.
 *
 * ⚠️ EXTRACTED, not shaved (release Constraint 6, and the 300-line gate that put
 * `verdict-seat-loss.js` in its own leaf): #219's correction took run-retry.js to
 * 314/300. Its own module also makes the property directly testable.
 *
 * SL-2 Task 5 (#129): a retry re-runs the SAME model under the SAME conditions,
 * so a latency failure is structurally unhealable — double the window rather
 * than repeat it. ⚠️ #135 C0 took the base 240s -> 600s; deliberate, see
 * CHANGELOG (council A1, PR #182).
 *
 * ⚠️ CLAMPED STRICTLY BELOW the leg timeout, not TO it (#219, council gpt
 * major). `Math.min(2 * backstop, legTimeoutMs)` made the two deadlines EQUAL
 * whenever `2 * backstop >= legTimeoutMs` — exactly CI today (2 x 480000 ===
 * 960000 === `--timeout 16`). The backstop still won, but only by epsilon and
 * only because the poll loop tests its deadline BEFORE sleeping, so the final
 * poll lands just past the wall. That is an undocumented accident of loop order;
 * if it ever lost, the leg would die a generic `timeout` and throw away the
 * named NO_OUTPUT_BACKSTOP diagnosis this clamp exists to preserve.
 *
 * A PROPORTIONAL headroom, not a fixed subtraction: a constant large enough to
 * beat a poll cycle (seconds) would drive a small leg cap to zero or negative,
 * and `ms <= 0` is the documented DISABLE hatch — silently disabling the backstop
 * is far worse than the race it fixes. 5% of any realistic leg cap clears the 2 s
 * poll interval by a wide margin.
 *
 * `2 * 0 === 0` still disables, because `Math.min(0, anything positive) === 0`.
 */

'use strict';

/**
 * @param {number} baseBackstopMs the first attempt's resolved no-output window
 * @param {number} legTimeoutMs the per-leg hard cap ((o.timeout || 15) * 60_000)
 * @returns {number} the retry's window: doubled, clamped strictly below the cap
 */
function retryBackstopMs(baseBackstopMs, legTimeoutMs) {
  return Math.min(2 * baseBackstopMs, Math.floor(legTimeoutMs * 0.95));
}

module.exports = { retryBackstopMs };
