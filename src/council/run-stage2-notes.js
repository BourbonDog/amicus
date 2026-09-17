'use strict';

/**
 * @module council/run-stage2-notes
 * Pure note-builders for Stage 2, on the same terms as `run-retry-notes.js`:
 * no I/O, no ctx, plain data in and a record ready for `degrade.note(...)` out.
 * It lives here rather than in `run.js` because that file sits exactly on the
 * 300-line gate, and rather than in `run-stage2.js` because the thin-cross-review
 * decision belongs to the ORCHESTRATOR — Stage 2 reports per-judge losses
 * (`stage2-judge`), `run.js` decides whether what survived is a cross-review at all.
 *
 * WHY THE `why` IS DERIVED AND NOT WRITTEN. It used to be the fixed sentence
 * 'the other judges produced no parseable Stage-2 block', emitted whenever
 * `usableJudges < 2` whatever had actually happened. On PR #254 round 1
 * (2026-09-16) the three missing judges DIED at the `NO_OUTPUT_BACKSTOP` — a
 * `stage2-judge` degrade fired for each, naming the dead leg — and not one of
 * them returned an unparseable block. The note is the run's own account of why
 * its verdict rests on one judge, and it named a cause nobody had observed:
 * a dead leg is a window/retry problem, an unparseable block is an output-contract
 * problem, and the fixes are not the same (#202, #251 item 3).
 */

/** Thin-cross-review is announced below TWO usable judges: one judge is not a
 *  cross-review, it is a second opinion. Named so the threshold has one home. */
const MIN_CROSS_REVIEW_JUDGES = 2;

/**
 * Why fewer than two judges came back usable, in the judges' own terms.
 *
 * ⚠️ `died` and `emptyAnswer` are STAMPED by `run-stage2.js` beside its own
 * `legDied` predicate (`run-stage2.js:181`) and never re-derived here. That
 * predicate is `!(leg.status === 'complete' && leg.summary)` — died = NOT
 * (complete WITH a non-empty summary) — and it is the one this codebase already
 * shares between the DEAD_LEG classification and the `stage2-judge` degrade;
 * spelling it a third time is how the three would drift into disagreeing about
 * which judges died.
 *
 * FOUR buckets, not two (council #263 r1, D3 + A1):
 *   · died        — the leg never came back at all.
 *   · emptyAnswer — it ran to 'complete' and said NOTHING. `legDied` is true for
 *                   this too, but "died before answering" points a CI reader at
 *                   a dead process when the process finished (D3).
 *   · unparseable — it answered, unusably.
 *   · pre-marker  — `died` is ABSENT: a Stage-2 checkpoint written by a build
 *                   older than #251 and resumed by this one. Absent is not
 *                   false; counting it as "no parseable block" would be a claim
 *                   about a judge that may well have died — the same wrong-cause
 *                   defect this note exists to remove (A1). It gets a bucket
 *                   that says only what is known: nothing.
 * @param {Array<{ok: boolean, died?: boolean, emptyAnswer?: boolean}>} judgeResults
 * @returns {string}
 */
function thinCrossReviewWhy(judgeResults) {
  const failed = judgeResults.filter(j => !j.ok);
  const preMarker = failed.filter(j => j.died === undefined).length;
  const empty = failed.filter(j => j.died === true && j.emptyAnswer === true).length;
  const died = failed.filter(j => j.died === true).length - empty;
  const unparseable = failed.filter(j => j.died === false).length;
  const clauses = [];
  if (died > 0) { clauses.push(`${died} judge leg${died === 1 ? '' : 's'} died before answering`); }
  if (empty > 0) { clauses.push(`${empty} returned an empty answer`); }
  if (unparseable > 0) { clauses.push(`${unparseable} returned no parseable Stage-2 block`); }
  if (preMarker > 0) {
    clauses.push(`${preMarker} judge result${preMarker === 1 ? '' : 's'} `
      + `predate${preMarker === 1 ? 's' : ''} the died marker (outcome unknown)`);
  }
  // Neither: every judge that ran came back usable and there were simply not
  // enough of them. The old sentence asserted a failure of judges that never
  // existed — a one-judge bench is a BENCH fact, not a judging fact.
  if (clauses.length === 0) {
    const n = judgeResults.length;
    return `the bench seated only ${n} judge${n === 1 ? '' : 's'}, `
      + 'fewer than the two a cross-review needs';
  }
  return clauses.join('; ');
}

/**
 * The thin-cross-review degrade, or null when the cross-review was not thin.
 * Returning the record (rather than noting it) keeps this pure and keeps
 * `run-degrade.js` the only place a degrade is announced.
 * @param {Array<{ok: boolean, died?: boolean}>} judgeResults
 * @returns {{channel: string, what: string, why: string, effect: string}|null}
 */
function thinCrossReviewNote(judgeResults) {
  const usable = judgeResults.filter(j => j.ok).length;
  if (usable >= MIN_CROSS_REVIEW_JUDGES) { return null; }
  return {
    channel: 'thin-cross-review',
    what: `only ${usable} of ${judgeResults.length} judges returned a usable cross-review`,
    why: thinCrossReviewWhy(judgeResults),
    effect: 'findings were tiered on a thinner cross-review than the bench size implies; '
      + 'will exit degraded (2)',
  };
}

module.exports = { thinCrossReviewNote, thinCrossReviewWhy, MIN_CROSS_REVIEW_JUDGES };
