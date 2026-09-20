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

// #219 (council, glm minor): `leg.error` is UNTRUSTED provider text. The house
// sanitizer — one sanitizer, one dialect (utils/text-sanitize.js). It arrived
// here with `judgeDeadNote` below (#257 headroom); `run-stage2.js` no longer
// renders provider text itself, so the require moved with the only use.
const { collapseExcerpt } = require('../utils/text-sanitize');
// #257: ONE vocabulary for a promoted leg's facts. ./promoted is a LEAF (it
// requires nothing), so this module stays cycle-free. Reading the token counts
// through `promotedFacts` rather than off `leg.usage.tokens` by hand is what
// keeps this module and ./promoted agreeing about the same field (R-X13).
// R-X44: `tokenSplit` renders the still-unread sentence's parenthetical too, so
// an unreported count reads "token usage not reported" here exactly as it does
// in the Stage-1 notes and the chair walk, rather than this module hand-rolling
// its own copy that would have interpolated the literal word "null".
const { promotedFacts, tokenSplit } = require('./promoted');

/**
 * #202's judge-death record, moved VERBATIM out of `run-stage2.js`'s leg loop
 * (#257 headroom: that file stood at 298 of the 300-line gate). Zero behaviour —
 * `tests/council/run-stage2-notes.test.js` pins it against the old inline object
 * literal typed out by hand, and every `stage2-judge` assertion in
 * `run-stages.test.js` is unchanged.
 *
 * ⚠️ No `kind`, deliberately: the record takes makeDegrade's default
 * ('degrade'), so run-degrade.js's sink sets `degraded.value` and the run exits
 * 2. That is the owner's call recorded at the call site — before it, a
 * half-adjudicated verdict could exit 0.
 * @param {{judge: string, seat: object|null, leg: object, judgesCount: number,
 *   runId: string}} args
 * @returns {{channel: string, what: string, why: string, effect: string, data: object}}
 */
function judgeDeadNote({ judge, seat, leg, judgesCount, runId }) {
  return {
    channel: 'stage2-judge',
    what: `judge ${judge} did not adjudicate`,
    // #219: `why` is PROSE — it reaches the stderr `Notice:` line, run.json, and
    // the `amicus council report` Markdown — so the provider's text is collapsed
    // to one bounded line. `data.reason` below stays VERBATIM on purpose: it is the machine
    // surface, it is JSON (nothing to inject), and truncating it would cost
    // exactly the fidelity a reader opens run.json for.
    why: `its Stage-2 leg ended '${leg.status}'`
      + (leg.error ? `: ${collapseExcerpt(leg.error, 200)}` : ''),
    effect: `the cross-review was adjudicated by fewer than the ${judgesCount} judges the `
      + 'bench implies; the run continues and will exit degraded (2)',
    data: { judge, seat: seat ? seat.id : null, waveId: `${runId}-s2`,
      status: leg.status, reason: leg.error || null },
  };
}

/**
 * #257 (spec R4/R11, ruling R-X32 — owner decision A′): a judge whose leg
 * answered only in its reasoning channel. Kind 'info' on every arm: the exit
 * code does not move here, and a lost judge is already counted by
 * thin-cross-review below.
 *
 * A JUDGE'S RETRY IS THE RELAUNCH. The earlier note said "a judge has no
 * retry", and used that to justify reading the deliberation as a judgement. It
 * is not one — it is the thinking that precedes one — so a promoted judge is
 * now relaunched once with the ORIGINAL bundle briefing (Stage 1's pattern:
 * retry, not repair, because a repair solo is a fresh session with no bundle
 * and so cannot succeed). `standDown` records how that ended — ONE explicit
 * state (council round 3, C4), set by the caller where the cause is KNOWN,
 * replacing the `{ attempts, relaunch }` pair this function used to re-derive it
 * from. Rescued endings carry no `standDown` at all and key on `attempts`:
 *   · null (rescued)        — the relaunch's own adjudication (attempts 1) or
 *                             its one LC-12 repair's (attempts 2) was used.
 *   · 'relaunch-promoted'   — the relaunch answered in its reasoning channel AGAIN.
 *   · 'relaunch-died'       — it came back with no usable text at all.
 *   · 'relaunch-unparseable'— it answered for real and the one repair also failed.
 *   · 'relaunch-unrepaired' — it answered for real and the cost ceiling arrived
 *                             before that repair could run (review I1).
 *   · 'not-relaunched'      — no relaunch ran: the cost ceiling arrived first.
 *   · 'repair-promoted'     — R-X36's arm, and the ONE whose subject is not the
 *                             judge's own answer; see the fork below.
 * EVERY one of those is announced, rescued or not: a silent path fails the
 * product bar as hard as a crash, and a stood-down judge changes the verdict's
 * basis. `rescued` and `relaunched` are emit-when-true, house style, so a
 * consumer reading either key is never reading a guess.
 * @param {string} judge alias
 * @param {object|null} seat
 * @param {object} leg the judge's ORIGINAL Stage-2 wave leg (#83's convention)
 * @param {{attempts?: number, rescued?: boolean, standDown?: ?string,
 *   repairPromotedAttempt?: ?number}} [opts]
 *   `attempts` is the `-q<N>` counter the caller already tracks (1 = the
 *   relaunch, 2 = its one repair); `rescued` says whether an adjudication was
 *   used in the end; `repairPromotedAttempt` belongs to the R-X36 arm alone and
 *   is the attempt number of the repair that came back promoted — NOT
 *   `attempts`, which is how many ran in total.
 * @returns {{kind: string, channel: string, what: string, why: string, effect: string, data: object}}
 */
function promotedJudgeNote(judge, seat, leg, { attempts = 0, rescued = false, standDown = null,
  repairPromotedAttempt = null } = {}) {
  const notCounted = 'the judge is not counted; the cross-review proceeds with the judges that '
    + 'answered, and thin-cross-review fires below two';
  // #257 R-X36 (council round 3, B1): the one arm whose subject is the REPAIR.
  // The judge's own answer was REAL — just unparseable — and the `-q<N>` repair
  // of it came back promoted. Both the `what` and the `data` fork on purpose:
  // the promoted-original sentence would tell a reader the judge's own answer
  // was deliberation, and `reasoningTokens`/`outputTokens` account for a
  // promoted ORIGINAL's leg, which this is not.
  if (standDown === 'repair-promoted') {
    return { kind: 'info', channel: 'judge-reasoning-only',
      what: `judge ${judge}'s repair answered in its reasoning channel`,
      why: `its own answer was real but did not parse; repair attempt ${repairPromotedAttempt} `
        + 'was written in the reasoning channel and is not a judgement, and the judge ended unusable',
      effect: notCounted,
      data: { judge, seat: seat ? seat.id : null, attempts, repairPromotedAttempt } };
  }
  // A non-promoted leg cannot reach here (the call site gates on isPromotedLeg),
  // so the fallback is defensive only — it keeps the sentence renderable rather
  // than throwing inside an announcement.
  const facts = promotedFacts(leg) || { reasoning: null, output: null, finish: null };
  const { reasoning, output } = facts;
  // R-X44: `tokenSplit` decides "token usage not reported" vs the numbers, so a
  // judge leg whose usage was never recorded reads that here too — `data`
  // below still carries the raw (possibly null) counts, a machine field.
  const unread = `the deliberation itself was read by nobody (${tokenSplit(facts)})`;
  const relaunched = 'relaunched once with the original briefing, and ';
  // One sentence per ENDING, naming what actually happened rather than the one
  // outcome the spec first imagined.
  const cause = rescued
    ? (attempts === 2
      ? `${relaunched}the relaunch's answer needed one repair — the adjudication used came from that repair (attempt 2)`
      : `${relaunched}that relaunch's adjudication is the one used`)
    : ({ 'relaunch-promoted': `${relaunched}the relaunch answered in its reasoning channel again`,
      'relaunch-died': `${relaunched}the relaunch produced no usable text`,
      'relaunch-unparseable': `${relaunched}the relaunch's answer did not parse after its one repair`,
      // Review I1: the repair is NOT guaranteed to have run — `ctx.overBudget()`
      // is re-checked between the relaunch and it (run-stage2-judge.js's `while`),
      // which is why this is a state of its own rather than the arm above read
      // through `attempts`. Naming a repair that never launched is the same defect
      // R-X13 was raised to remove, and `data.attempts` would contradict the
      // prose in the same record.
      'relaunch-unrepaired': `${relaunched}the relaunch's answer did not parse — the cost ceiling was reached before its repair`,
    }[standDown] || 'not relaunched — the cost ceiling was reached first');
  // The relaunch is what every arm but 'not-relaunched' has in common, and a
  // rescue is only ever reached THROUGH it — so this is a read of the state, not
  // a second encoding of it.
  const relaunchRan = rescued || (!!standDown && standDown !== 'not-relaunched');
  return { kind: 'info', channel: 'judge-reasoning-only',
    what: `judge ${judge} answered in its reasoning channel`,
    why: `its own answer was its deliberation, not a judgement; ${cause}; ${unread}`,
    effect: rescued ? 'the adjudication counts; nothing else changes' : notCounted,
    data: { judge, seat: seat ? seat.id : null, reasoningTokens: reasoning, outputTokens: output,
      attempts, ...(relaunchRan ? { relaunched: true } : {}), ...(rescued ? { rescued: true } : {}) } };
}

/** Thin-cross-review is announced below TWO usable judges: one judge is not a
 *  cross-review, it is a second opinion. Named so the threshold has one home. */
const MIN_CROSS_REVIEW_JUDGES = 2;

/**
 * Why fewer than two judges came back usable, in the judges' own terms.
 *
 * ⚠️ `died` and `emptyAnswer` are STAMPED beside their own `legDied`
 * predicate in `run-stage2-judge.js :: adjudicateJudgeLeg`, and never re-derived here. That
 * predicate is `!(leg.status === 'complete' && leg.summary)` — died = NOT
 * (complete WITH a non-empty summary) — and it is the one this codebase already
 * shares between the DEAD_LEG classification and the `stage2-judge` degrade;
 * spelling it a third time is how the three would drift into disagreeing about
 * which judges died.
 *
 * FIVE buckets, not two (council #263 r1, D3 + A1; #257 added `fromReasoning`):
 *   · died        — the leg never came back at all.
 *   · emptyAnswer — it ran to 'complete' and said NOTHING. `legDied` is true for
 *                   this too, but "died before answering" points a CI reader at
 *                   a dead process when the process finished (D3).
 *   · unparseable — it answered, unusably.
 *   · fromReasoning — #257 (spec R4): its engine answer had no text part, so the
 *                   leg came back `promoted: true` and run-stage2-judge.js stamped
 *                   `fromReasoning`. A SUBSET of unparseable, split out for the
 *                   same reason the other three were: "returned no parseable
 *                   Stage-2 block" names the output contract for what is a
 *                   missing-text-part fact about the engine, and the fixes differ.
 *                   Review M1: the clause says "and was not rescued" rather than
 *                   "with no parseable block" because under R-X32 such a judge
 *                   HAS been relaunched, and that relaunch may have answered in
 *                   the OUTPUT channel unparseably — true of all four stand-down
 *                   causes, while the per-judge `judge-reasoning-only` Note
 *                   carries the exact one.
 *   · pre-marker  — `died` is ABSENT: a Stage-2 checkpoint written by a build
 *                   older than #251 and resumed by this one. Absent is not
 *                   false; counting it as "no parseable block" would be a claim
 *                   about a judge that may well have died — the same wrong-cause
 *                   defect this note exists to remove (A1). It gets a bucket
 *                   that says only what is known: nothing.
 * @param {Array<{ok: boolean, died?: boolean, emptyAnswer?: boolean,
 *   fromReasoning?: boolean}>} judgeResults
 * @returns {string}
 */
function thinCrossReviewWhy(judgeResults) {
  const failed = judgeResults.filter(j => !j.ok);
  const preMarker = failed.filter(j => j.died === undefined).length;
  const empty = failed.filter(j => j.died === true && j.emptyAnswer === true).length;
  const died = failed.filter(j => j.died === true).length - empty;
  const fromReasoning = failed.filter(j => j.died === false && j.fromReasoning === true).length;
  const unparseable = failed.filter(j => j.died === false).length - fromReasoning;
  const clauses = [];
  if (died > 0) { clauses.push(`${died} judge leg${died === 1 ? '' : 's'} died before answering`); }
  if (empty > 0) { clauses.push(`${empty} returned an empty answer`); }
  if (unparseable > 0) { clauses.push(`${unparseable} returned no parseable Stage-2 block`); }
  if (fromReasoning > 0) {
    clauses.push(`${fromReasoning} answered only in the reasoning channel and was not rescued`);
  }
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
 * @param {Array<{ok: boolean, died?: boolean, emptyAnswer?: boolean,
 *   fromReasoning?: boolean}>} judgeResults
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

module.exports = {
  thinCrossReviewNote, thinCrossReviewWhy, MIN_CROSS_REVIEW_JUDGES,
  judgeDeadNote, promotedJudgeNote,
};
