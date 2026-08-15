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

/**
 * Wave-origin, retry wave died wholesale (D5 wave granularity).
 *
 * v4.8 PR2b Task 7: a `partial` record (stage1-bind.js's missingSeatDeadWave) is
 * ONE seat of a wave that DID return legs, so the dead-wave sentence would be a
 * false statement in a user-facing degrade — it names the seat instead, on the
 * `seat-unbound` channel the other half of that join failure already uses.
 */
function waveStillDeadNote(w, unit) {
  const partial = !!w.partial;
  return { channel: partial ? 'seat-unbound' : 'dead-wave',
    what: partial
      ? `seat ${(w.models || [])[0]} did not review`
      : `Stage-1 wave ${w.waveId} (${(w.models || []).join(', ') || 'no models'}) produced NO legs`,
    // Coordinator-review MINOR-7c: a falsy w.reason must not render as the
    // literal string "undefined" in the why text.
    why: `${w.reason || 'no reason recorded'}; the once-only retry wave also produced no legs`,
    effect: 'Those seats are NOT in this council. The run continues with the bench that did '
      + 'launch and will exit degraded (2)',
    // `seat` rides ONLY on the partial shape: adding it unconditionally breaks
    // degrade-channels.test.js's exact toEqual on a real dead wave. It stays the
    // ALIAS because verdict.js:72 compares data.seat against o.critic, an alias,
    // and because it is the same key the dead-leg shape uses — one vocabulary
    // for one field. ⚠️ It is NOT read by the Workspace today: live-seats.js:203,
    // workspace-seats.js:69 and verdict.js:68 and :71 all filter to channels that
    // are dead-leg/dead-wave, so no surface consumes `seat-unbound` yet (PR4).
    data: { waveId: w.waveId, models: w.models, reason: w.reason, retryWaveId: unit.waveId,
      // v4.8 PR5c: seat identity, index-parallel with `models`, on the dead-wave arm only
      // (the partial arm names ONE seat and rides `seat` above; `seat-unbound` has no
      // consumer, so an array there would be unpinned surface for no gain).
      // ⚠️ An unidentified slot emits `null`, NEVER the alias. Collapsing it onto the alias
      // makes it indistinguishable from a second reference to that alias, and no consumer
      // can recover the difference — deadSeats has no per-alias seat count. That collapse
      // is what made two distinct dead twins render as a single row.
      ...(partial ? { seat: (w.models || [])[0] } : {
        seats: (w.models || []).map((m, i) => {
          const so = (w.seats || [])[i];
          return so ? so.id : null;
        }),
      }) } };
}

/**
 * Leg-origin, retry wave died wholesale (bench-batch case).
 *
 * v4.8 PR5c: `seatId` is the caller's Stage-1 leg->seat binding, or null when the leg was
 * never bound. It is a SEPARATE key from `seat`, which stays the ALIAS — verdict.js:72
 * compares `data.seat` against `o.critic`, an alias, so re-pointing it breaks critic-loss
 * detection. Add a key; never repurpose that one.
 */
function srcLegStillDeadNote(leg, unit, counts, seatId = null) {
  const seat = leg.modelInput || leg.model;
  return { channel: 'dead-leg', what: `seat ${seat} did not review`,
    why: `the leg ended '${leg.status}'${leg.error ? `: ${leg.error}` : ''} with no usable output; `
      + 'its once-only retry wave produced no legs',
    effect: legEffect(counts),
    data: { seat, seatId: seatId || null, status: leg.status, reason: leg.error || null,
      retryWaveId: unit.waveId } };
}

/**
 * Either origin, the retry produced legs but THIS seat's retry leg died.
 *
 * A 'missing' first failure has a `reason` and a `waveId` but NEVER a `status` —
 * the leg arm would report that its first leg "ended 'undefined'" for a seat
 * that never had a first leg at all.
 */
function retryLegStillDeadNote(seat, ff, retryLeg, unit, counts) {
  const missing = !!(ff && ff.class === 'missing');
  const why = ff && ff.class === 'wave'
    ? `its first wave ${ff.waveId} produced no legs (${ff.reason}); `
      + `its once-only retry leg ended '${retryLeg.status}' with no usable output`
    : missing
      ? `${ff.reason} in wave ${ff.waveId}; its once-only retry leg ended `
        + `'${retryLeg.status}' with no usable output`
      : `the leg ended '${ff ? ff.status : 'unknown'}'${ff && ff.reason ? `: ${ff.reason}` : ''} `
        + `with no usable output; its once-only retry also ended '${retryLeg.status}'`;
  return { channel: missing ? 'seat-unbound' : 'dead-leg', what: `seat ${seat} did not review`, why,
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
  const missing = !!(ff && ff.class === 'missing');
  const fact = ff && ff.class === 'wave'
    ? `its first wave ${ff.waveId} produced no legs (${ff.reason})`
    : missing
      ? `${ff.reason} in wave ${ff.waveId}`
      : `the leg ended '${ff ? ff.status : 'unknown'}'${ff && ff.reason ? `: ${ff.reason}` : ''} with no usable output`;
  return { channel: missing ? 'seat-unbound' : 'dead-leg', what: `seat ${seat} did not review`,
    why: `${fact}; its once-only retry produced no leg for this seat`,
    effect: legEffect(counts),
    data: { seat, status: null, reason: null, firstFailure: ff, retryWaveId: unit.waveId } };
}

module.exports = { waveStillDeadNote, srcLegStillDeadNote, retryLegStillDeadNote, missingLegStillDeadNote };
