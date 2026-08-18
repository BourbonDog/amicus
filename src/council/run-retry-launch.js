// src/council/run-retry-launch.js
'use strict';
// The retry pass's LAUNCH side: briefingFor + bindRetryWave. Lifted out of
// run-retry.js (v4.8 Phase 2 T-A2 size-gate split, zero behavior) — briefingFor
// byte-for-byte, the roster pad/bind block as a PURE function that returns its
// bindings rather than mutating the orchestrator's accumulator.
// run-retry.js requires both back, so no existing import path moved.
// ⚠️ Not `stage1-bind.js`: `bindStage1Waves` is a different contract (one call per
// Stage-1 wave, a real roster, no padding, no placeholders). Consolidating the three
// padding sites is separately scheduled (BACKLOG.md's SI-27, ruling R14).

const briefings = require('./briefings');
const { bindSeats } = require('./seats');

/** The briefing a retry unit re-issues — same builders Stage 1 used. */
function briefingFor(o, unit) {
  if (unit.unit === 'critic') { return briefings.buildCriticBriefing({ briefing: o.briefing, date: o.date }); }
  if (unit.unit === 'lens') {
    return briefings.buildLensBriefing({ lens: o.lenses[unit.lensIndex - 1], briefing: o.briefing, date: o.date });
  }
  return briefings.buildSeatBriefing({ briefing: o.briefing, date: o.date });
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
  // A null entry means "we could not identify this seat"; pad it with a
  // position-stable placeholder carrying a UNIQUE id so no slot shifts, then
  // drop the placeholder binds so nothing is guessed.
  // ⚠️ Never pass unit.seats raw and never use a null-id sentinel: seats.js
  // filters falsy roster entries internally (so raw === filtered, and both
  // slide every later slot into a hole), and two `{id: null}` sentinels
  // collide on the id-keyed dedup.
  // Placeholders are tracked by IDENTITY, never by an id-name prefix test: a
  // bench alias that literally began `__unbound-` would make a name test drop
  // a REAL seat's binding — a name-collision channel inside the one mechanism
  // whose whole contract is "never guess".
  const placeholders = new Set();
  const retryRoster = unit.seats.map((s, i) => {
    if (s) { return s; }
    const p = { id: `__unbound-${unit.waveId}-${i + 1}`, alias: unit.models[i], role: 'seat', lens: null, position: i + 1 };
    placeholders.add(p);
    return p;
  });
  const bindRes = bindSeats(unit.waveId, retryRoster, legs);
  const retrySeatOf = new Map(bindRes.bound
    .filter(b => !placeholders.has(b.seat))
    .map(b => [b.leg, b.seat]));
  return { retrySeatOf, orphanLegs: bindRes.orphanLegs };
}

module.exports = { briefingFor, bindRetryWave };
