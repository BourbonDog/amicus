// src/council/verdict-seat-loss.js
'use strict';

/**
 * @module council/verdict-seat-loss
 * The verdict's seat-loss surface: `summarizeSeatLoss` (v4.5.2) and
 * `deriveSeatLoss` (v4.6 Plan 2, spec D3) — lifted VERBATIM out of verdict.js
 * for the 300-line gate (v4.9 PR #200 fix round 3), on the W4 chair-fallback
 * precedent. The extraction itself was a pure MOVE: same bodies, same
 * docblocks, same exports, and verdict.js re-exports both so no caller changes.
 * (v4.9 W9 has since edited `deriveSeatLoss`'s body here — the identity pins
 * below cover the MOVE, not a freeze.) Their behaviour stays pinned where it
 * already was (tests/council/verdict-seat-loss.test.js,
 * tests/council/verdict-degrades.test.js), both of which still import through
 * verdict.js — if the move changed anything, those go red.
 *
 * Pure: no IO, no verdict-document knowledge. Nothing in this file requires
 * verdict.js, so the dependency runs one way only.
 */

/**
 * Describe which requested seats actually reviewed, for the verdict's own face.
 *
 * ⚠️ ADDED v4.5.2 from a field report. The critic is a SOLO wave with one leg,
 * so losing it loses 100% of the adversarial role — and unlike a dead bench wave
 * (which trips the quorum gate and fails the run loudly) a dead critic is
 * survivable, so the run continues to a full verdict, tally and chair synthesis
 * that never saw the critic's findings. Run `dfb6a692` did exactly that and the
 * only record was `deadWaves` in run.json, a file nobody opens when the verdict
 * reads clean. A user who typed `--critic` asked for adversarial review; a
 * verdict produced without it must say so where the verdict is read.
 *
 * Returns null when no critic was requested — there is nothing to report, and an
 * always-present block would train readers to ignore it.
 *
 * @param {{runId: string, critic: ?string,
 *   deadWaves: Array<{waveId: string, models: string[], reason: string}>}} o
 * @returns {?{criticRequested: string, criticSeated: boolean, reason: ?string,
 *   deadBenchSeats: string[]}}
 */
function summarizeSeatLoss({ runId, critic, deadWaves = [] } = {}) {
  if (!critic) { return null; }
  // Match on EITHER carrier. The `-c1` suffix is the convention run-stages.js
  // uses, but a wave that names the critic model is the critic wave whatever it
  // is called — and relying on the id alone would silently under-report if that
  // convention ever changes.
  const isCriticWave = w =>
    w.waveId === `${runId}-c1` || (w.models || []).includes(critic);
  const dead = deadWaves.find(isCriticWave) || null;
  return {
    criticRequested: critic,
    criticSeated: !dead,
    reason: dead ? dead.reason : null,
    deadBenchSeats: deadWaves.filter(w => !isCriticWave(w))
      .flatMap(w => w.models || []),
  };
}

/**
 * seatLoss, derived from the sink's records (v4.6 Plan 2, spec D3 — closes #84).
 *
 * WHY A DERIVATION: two fields reporting lost seats can disagree; deriving one
 * from the other makes contradiction inexpressible. `summarizeSeatLoss` stays
 * exactly as v4.5.2 shipped it (its tests pass unedited — that is the proof the
 * shape survived); this function rebuilds its wave input from `dead-wave`
 * records and then adds the losses waves can never show: `dead-leg` records —
 * a solo critic wave that STARTED but whose one leg died is invisible to
 * deadWaves (#84's second half) — plus v4.9 W9's gated `seat-unbound` family.
 *
 * Reads ONLY record.data (Task 1's machine surface) — never the prose fields.
 * @param {{runId: string, critic: ?string, degrades: Array<object>}} o
 * @returns {?object} the summarizeSeatLoss shape, or null when no critic was requested
 */
function deriveSeatLoss({ runId, critic, degrades = [] } = {}) {
  if (!critic) { return null; }
  // v4.9 W9 (SI-02). ⚠️ THIRD spelling of one admission rule; its renderer twins are
  // `live-dead-seats.js :: isSeatLoss` and `workspace-seats.js :: retriedSeats`, which cannot
  // require src/ — all three move together, enforced only by workspace-seats.test.js's drift
  // pin. `seat-unbound` is GATED: orphan-leg, re-vote and Stage-2 judge notes share it, are NOT
  // seat losses, and carry no retry-family field. (R-W9a is CLOSED at the producer in the W9 fix
  // round: `run-retry-notes.js :: skippedWaveNote` emits the `firstFailure` fact its record
  // already carried, so this unchanged gate admits that real loss and still excludes the three.)
  // ⚠️ The kind test admits a kind-LESS record as a degrade — W9 fix round, council C4. The
  // POSITIVE-only spelling rested on an ASSERTED caller inventory (everything here comes from
  // `makeDegrade`, which stamps the default), which is convention, not structure: one new
  // caller, or one hand-written record, and a real seat loss vanishes silently. `report.js`
  // learned it as mutant LEGACYDROP; the two renderers now spell it exactly as this line does.
  // What all four agree on is that an ABSENT kind is a loss — their kind LISTS still differ,
  // deliberately. `heal`/`info` name themselves here and are still excluded.
  const gatedUnbound = d => d.channel === 'seat-unbound'
    && (d.data.retryWaveId || d.data.firstFailure) && (d.data.seatId || d.data.seat);
  const real = degrades.filter(d => (d.kind === undefined || d.kind === 'degrade') && d.data
    && (d.channel === 'dead-leg' || d.channel === 'dead-wave' || gatedUnbound(d)));
  const waves = real.filter(d => d.channel === 'dead-wave')
    .map(d => ({ waveId: d.data.waveId, models: d.data.models || [], reason: d.data.reason }));
  const base = summarizeSeatLoss({ runId, critic, deadWaves: waves });
  const legs = real.filter(d => d.channel !== 'dead-wave');
  // ⚠️ STAYS ALIAS-KEYED — decided and measured in v4.9 W9 (R4), not mirrored from the
  // renderers' seat-key fix. `seats.js :: preflightSeats` REFUSES a critic alias occupying
  // more than one bench seat, zero-spend, before any leg launches, so on every run this can see
  // `data.seat === critic` names exactly one seat and alias equality IS seat equality; its only
  // production caller, `run-verdict-files.js :: writeVerdictFiles`, is fed in-process records
  // from that run's own sink. The renderers differ: they read run.json/verdict.json off DISK,
  // any version or hand edit, where that refusal is not in force.
  const criticLeg = legs.find(l => l.data.seat === critic) || null;
  return {
    ...base,
    criticSeated: base.criticSeated && !criticLeg,
    // SL-2 handoff: a reconciliation note (run-retry-notes.js's
    // missingLegStillDeadNote) carries data.status: null when the retry
    // produced no leg for the seat at all — there is no status to name, so
    // the old `ended '${status}'` template rendered the literal string
    // "ended 'null'". A status-carrying record keeps the original text.
    reason: base.reason || (criticLeg
      ? (criticLeg.data.reason || (criticLeg.data.status
        ? `the critic leg ended '${criticLeg.data.status}' with no usable output`
        : 'the critic leg produced no usable output'))
      : null),
    deadBenchSeats: [...base.deadBenchSeats,
      ...legs.filter(l => l.data.seat !== critic).map(l => l.data.seat)],
  };
}

module.exports = { summarizeSeatLoss, deriveSeatLoss };
