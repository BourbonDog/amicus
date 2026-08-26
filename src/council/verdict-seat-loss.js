// src/council/verdict-seat-loss.js
'use strict';

/**
 * @module council/verdict-seat-loss
 * The verdict's seat-loss surface: `summarizeSeatLoss` (v4.5.2) and
 * `deriveSeatLoss` (v4.6 Plan 2, spec D3) — lifted VERBATIM out of verdict.js
 * for the 300-line gate (v4.9 PR #200 fix round 3), on the W4 chair-fallback
 * precedent. Pure MOVE: same bodies, same docblocks, same exports, and
 * verdict.js re-exports both so no caller changes. Their behaviour stays pinned
 * where it already was (tests/council/verdict-seat-loss.test.js,
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
 * deadWaves, which is #84's second half.
 *
 * Reads ONLY record.data (Task 1's machine surface) — never the prose fields.
 * @param {{runId: string, critic: ?string, degrades: Array<object>}} o
 * @returns {?object} the summarizeSeatLoss shape, or null when no critic was requested
 */
function deriveSeatLoss({ runId, critic, degrades = [] } = {}) {
  if (!critic) { return null; }
  const real = degrades.filter(d => d.kind !== 'heal' && d.data);
  const waves = real.filter(d => d.channel === 'dead-wave')
    .map(d => ({ waveId: d.data.waveId, models: d.data.models || [], reason: d.data.reason }));
  const base = summarizeSeatLoss({ runId, critic, deadWaves: waves });
  const legs = real.filter(d => d.channel === 'dead-leg');
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
