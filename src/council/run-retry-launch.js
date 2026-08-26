// src/council/run-retry-launch.js
'use strict';
// The retry pass's LAUNCH side: briefingFor + bindRetryWave. Lifted out of
// run-retry.js (v4.8 Phase 2 T-A2 size-gate split, zero behavior) — briefingFor
// byte-for-byte, the roster pad/bind block as a PURE function that returns its
// bindings rather than mutating the orchestrator's accumulator.
// run-retry.js requires both back, so no existing import path moved.
// v4.8 SI-27 (ruling R14) landed: the pad/bind/drop CORE now lives in
// `stage1-bind.js :: bindPaddedWave`, shared with run-stage2.js and
// run-debate-revote.js. What stays here is retry-specific — WHICH array is the
// roster, and the orphan tail. ⚠️ `bindStage1Waves` in that same file is still a
// different contract (one call per Stage-1 wave, a real roster, no padding, no
// placeholders); `bindPaddedWave` is the one this file calls.

const briefings = require('./briefings');
const { bindPaddedWave } = require('./stage1-bind');

/** The briefing a retry unit re-issues — same intent-aware dispatchers Stage 1 used (v4.9 W6). */
function briefingFor(o, unit) {
  if (unit.unit === 'critic') { return briefings.stage1CriticBriefing(o.intent, { briefing: o.briefing, date: o.date }); }
  if (unit.unit === 'lens') {
    return briefings.stage1LensBriefing(o.intent, { lens: o.lenses[unit.lensIndex - 1], briefing: o.briefing, date: o.date });
  }
  return briefings.stage1SeatBriefing(o.intent, { briefing: o.briefing, date: o.date });
}

/**
 * Bind a retry wave's returned legs to the unit that launched them.
 *
 * PURE by design: the caller owns the accumulator. `retrySeatOf` is published into
 * `out.seatOf` and the orphan legs are re-emitted with their waveId by
 * `run-retry.js :: retryStage1Losses`, which also carries the rationale for why an
 * orphan is REPORTED rather than noted as a degrade.
 *
 * @param {{seats: Array<?object>, models: Array<string>, waveId: string}} unit
 * @param {Array<object>} legs the retry wave's returned legs
 * @returns {{retrySeatOf: Map<object, object>, orphanLegs: Array<object>}}
 */
function bindRetryWave(unit, legs) {
  // The retry wave's roster IS unit.seats — run-retry-group.js :: recordFailure
  // pushes models and seats in lockstep (it pushes NEITHER for the critic unit,
  // whose pair is seeded off one `o.critic` gate at creation and never grows), and
  // the legId `-N` suffix slot-indexes that same launch plan. `firstFailures` is a
  // WEAKER case and is not read here — see run-retry.js's mint.
  // A null entry means "we could not identify this seat". Why that hole is
  // PADDED rather than filtered, and why the placeholders are tracked by
  // identity rather than an id-name prefix test, are in the docblock of
  // `stage1-bind.js :: bindPaddedWave` — which owns all three steps.
  const { seatOf, bindRes } = bindPaddedWave(unit.waveId, unit.seats, i => unit.models[i], legs);
  // The tail: this site hands its orphans back to the caller (run-retry.js ::
  // retryStage1Losses re-emits them with their waveId).
  return { retrySeatOf: seatOf, orphanLegs: bindRes.orphanLegs };
}

module.exports = { briefingFor, bindRetryWave };
