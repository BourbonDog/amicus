'use strict';

/**
 * @module council/run-retry-notes
 * Pure note-builders for the SL-2 Stage-1 retry pass (split out of
 * run-retry.js for the 300-line gate — same rationale as run-stage2.js
 * splitting off run-stages.js, v4.4.1 Task 2). No I/O, no ctx: each function
 * takes plain data and returns a still-dead note ready for
 * `ctx.degrade.note(...)` (D5 final-failure granularity, spec §5). The heal
 * note is built inline in run-retry.js's orchestrator (it is the one place
 * that decides recovery, and stays small).
 */

/** D-effect parity: still-dead leg notes reuse today's count phrasing, with the
 *  FIRST attempt's counts — the why carries the retry story (spec §5). */
const legEffect = (counts) =>
  `${counts.reviewed} of ${counts.total} seats reviewed; `
  + 'the run continues with the bench that did and will exit degraded (2)';

/** Wave-origin, retry wave died wholesale (D5 wave granularity). */
function waveStillDeadNote(w, unit) {
  return { channel: 'dead-wave',
    what: `Stage-1 wave ${w.waveId} (${(w.models || []).join(', ') || 'no models'}) produced NO legs`,
    // Coordinator-review MINOR-7c: a falsy w.reason must not render as the
    // literal string "undefined" in the why text.
    why: `${w.reason || 'no reason recorded'}; the once-only retry wave also produced no legs`,
    effect: 'Those seats are NOT in this council. The run continues with the bench that did '
      + 'launch and will exit degraded (2)',
    data: { waveId: w.waveId, models: w.models, reason: w.reason, retryWaveId: unit.waveId } };
}

/** Leg-origin, retry wave died wholesale (bench-batch case). */
function srcLegStillDeadNote(leg, unit, counts) {
  const seat = leg.modelInput || leg.model;
  return { channel: 'dead-leg', what: `seat ${seat} did not review`,
    why: `the leg ended '${leg.status}'${leg.error ? `: ${leg.error}` : ''} with no usable output; `
      + 'its once-only retry wave produced no legs',
    effect: legEffect(counts),
    data: { seat, status: leg.status, reason: leg.error || null, retryWaveId: unit.waveId } };
}

/** Either origin, the retry produced legs but THIS seat's retry leg died. */
function retryLegStillDeadNote(seat, ff, retryLeg, unit, counts) {
  const why = ff && ff.class === 'wave'
    ? `its first wave ${ff.waveId} produced no legs (${ff.reason}); `
      + `its once-only retry leg ended '${retryLeg.status}' with no usable output`
    : `the leg ended '${ff ? ff.status : 'unknown'}'${ff && ff.reason ? `: ${ff.reason}` : ''} `
      + `with no usable output; its once-only retry also ended '${retryLeg.status}'`;
  return { channel: 'dead-leg', what: `seat ${seat} did not review`, why,
    effect: legEffect(counts),
    data: { seat, status: retryLeg.status, reason: retryLeg.error || null,
      firstFailure: ff, retryWaveId: unit.waveId } };
}

/**
 * CRITICAL fix (coordinator review): a launched seat can be missing a leg
 * record ENTIRELY from the retry response — a partial wave return (unit
 * models [a,b], the wave comes back with only a's leg). This is distinct
 * from `retryLegStillDeadNote` (the seat's retry leg came back but was
 * unusable) — here there is no retry-attempt status/error to report at all,
 * only the ORIGINAL first-failure fact plus the fact that nothing came back
 * this time.
 */
function missingLegStillDeadNote(seat, ff, unit, counts) {
  const fact = ff && ff.class === 'wave'
    ? `its first wave ${ff.waveId} produced no legs (${ff.reason})`
    : `the leg ended '${ff ? ff.status : 'unknown'}'${ff && ff.reason ? `: ${ff.reason}` : ''} with no usable output`;
  return { channel: 'dead-leg', what: `seat ${seat} did not review`,
    why: `${fact}; its once-only retry produced no leg for this seat`,
    effect: legEffect(counts),
    data: { seat, status: null, reason: null, firstFailure: ff, retryWaveId: unit.waveId } };
}

module.exports = { waveStillDeadNote, srcLegStillDeadNote, retryLegStillDeadNote, missingLegStillDeadNote };
