// src/council/stage1-bind.js
'use strict';
// Stage-1 seat binding (v4.8 workstream A, spec §4.4). Lives here rather than in
// run-stages.js because that file is at 292/300 and this is where the leg<->seat
// join and its two failure shapes belong together.

const { bindSeats } = require('./seats');

/**
 * Bind every Stage-1 wave to its own roster, ONE CALL PER WAVE.
 *
 * Never call bindSeats once over the flattened leg array: seats.js:133 admits a
 * leg with no waveId, so a concatenated array makes wave B's legs candidates for
 * wave A's slots. The waves[] entries from launchStage1 are already partitioned
 * by construction (run-stage1-launch.js captures each wave's own `got`).
 *
 * @param {Array<{waveId: string, roster: Array<object>, legs: Array<object>}>} waves
 * @returns {{seatOf: Map<object, object>,
 *   missingSeats: Array<{waveId: string, seat: object, returned: number, expected: number}>,
 *   orphanLegs: Array<{waveId: string, leg: object}>}}
 */
function bindStage1Waves(waves) {
  const seatOf = new Map();
  const missingSeats = [];
  const orphanLegs = [];
  for (const w of (Array.isArray(waves) ? waves : [])) {
    const legs = Array.isArray(w.legs) ? w.legs : [];
    const roster = Array.isArray(w.roster) ? w.roster : [];
    const { bound, unbound, orphanLegs: strays } = bindSeats(w.waveId, roster, legs);
    for (const b of bound) { seatOf.set(b.leg, b.seat); }
    for (const leg of strays) { orphanLegs.push({ waveId: w.waveId, leg }); }
    // A wave that returned ZERO legs contributes no missing seats: it is already a
    // dead wave (or a budget refusal, or an abort), each with its own louder
    // channel. A wave that returned legs we could NOT attribute contributes none
    // either: an orphan leg is a review that LANDED — materializeReviews writes it
    // under its alias name — for a seat we cannot name. Retrying that seat would
    // buy a SECOND paid leg and put two reviews on one seat, breaking the
    // invariant run-stages.js:142-151 states. The orphan is already announced on
    // `seat-unbound` at bind time (R-B: orphans are not a loss and not retryable).
    if (legs.length === 0 || strays.length > 0) { continue; }
    for (const seat of unbound) {
      missingSeats.push({ waveId: w.waveId, seat, returned: legs.length, expected: roster.length });
    }
  }
  return { seatOf, missingSeats, orphanLegs };
}

/**
 * A returned leg that matches no roster slot. Announced immediately — unlike a
 * missing seat it is not a loss and there is nothing to retry, and unlike a
 * mis-binding it is exactly the case where guessing would be wrong.
 */
function orphanLegNote(waveId, leg) {
  const legId = (leg && (leg.legId || leg.taskId)) || 'unidentified';
  const alias = (leg && (leg.modelInput || leg.model)) || 'unknown';
  return {
    channel: 'seat-unbound',
    what: `leg ${legId} in wave ${waveId} matches no seat on that wave's roster`,
    why: `its id names no roster slot of ${waveId}, and its model '${alias}' does not identify `
      + 'exactly one seat there',
    effect: 'Its review is kept under its model name and is NOT attributed to a seat; nothing was '
      + 'guessed and nothing was dropped',
    data: { waveId, legId, seat: alias },
  };
}

/**
 * Turn a missing seat into a single-seat dead-wave record so the ordinary SL-2
 * retry machinery relaunches it (owner ruling R-B). `partial: true` is what keeps
 * the prose honest downstream: the wave DID produce legs, so the plain dead-wave
 * sentence would be false.
 */
function missingSeatDeadWave(m) {
  return {
    waveId: m.waveId,
    models: [m.seat.alias],
    seats: [m.seat],
    // ASCII apostrophe deliberately: this string reaches a terminal through
    // formatDegrade, and a Windows console can mangle U+2019. It was the only
    // curly quote in src/ — and had no caller until v4.8 PR2b Task 7 shipped it.
    reason: `the wave returned ${m.returned} of ${m.expected} legs and none of them was this seat's`,
    partial: true,
  };
}

/**
 * Bind ONE wave whose roster may have HOLES: pad the holes, bind, then drop
 * every placeholder bind. Appended (never inserted) by v4.8 SI-27 / R14, which
 * consolidated the block that stood byte-identical at three call sites ONCE `waveId`
 * and the alias lookup are parameterised — site 2's callback was literally
 * `(r, i) => { if (r.seat) … }`, reading the seat off a review, not off a roster
 * slot. The three sites: `run-retry-launch.js :: bindRetryWave`,
 * `run-stage2.js :: bindStage2Seats` (in `runStage2` itself until the v4.9 W2
 * function-length split) and `run-debate-revote.js :: runRevoteWave`.
 *
 * How this differs from `bindStage1Waves` above: that one takes MANY waves, each
 * with a REAL roster — no padding, no placeholders, and it owns its own missing/
 * orphan bookkeeping. This one takes ONE wave and a roster source that may carry
 * falsy slots, and owns nothing past the bind.
 *
 * A falsy entry means "we could not identify this seat"; pad it with a
 * position-stable placeholder carrying a UNIQUE id so no slot shifts, then drop
 * the placeholder binds so nothing is guessed. ⚠️ Never pass `rosterSource` raw
 * and never use a null-id sentinel: `seats.js :: bindSeats` filters falsy roster
 * entries internally (so raw === filtered, and both slide every later slot into
 * a hole), and two `{id: null}` sentinels collide on the id-keyed dedup.
 *
 * Placeholders are tracked by IDENTITY, never by an id-name prefix test: a bench
 * alias that literally began `__unbound-` would make a name test drop a REAL
 * seat's binding — a name-collision channel inside the one mechanism whose whole
 * contract is "never guess".
 *
 * `bindRes` and `placeholders` come back raw because the ORPHAN/MISSING tail
 * differs at every call site and STAYS there: site 1 returns `orphanLegs` to its
 * caller, site 2 notes orphans and walks `bindRes.unbound` (skipping
 * `placeholders`) for missing seats, site 3 has no tail at all.
 *
 * No argument guards by design (R27-3): each call site keeps the guard it has.
 *
 * @param {string} waveId
 * @param {Array<?object>} rosterSource one entry per launched slot; falsy where the seat is unknown
 * @param {(i: number) => string} aliasAt the alias that launched in slot i
 * @param {Array<object>} legs the wave's returned legs
 * @returns {{seatOf: Map<object, object>,
 *   bindRes: {bound: Array<object>, unbound: Array<object>, orphanLegs: Array<object>},
 *   placeholders: Set<object>}}
 */
function bindPaddedWave(waveId, rosterSource, aliasAt, legs) {
  const placeholders = new Set();
  const roster = rosterSource.map((s, i) => {
    if (s) { return s; }
    const p = { id: `__unbound-${waveId}-${i + 1}`, alias: aliasAt(i), role: 'seat', lens: null, position: i + 1 };
    placeholders.add(p);
    return p;
  });
  const bindRes = bindSeats(waveId, roster, legs);
  const seatOf = new Map(bindRes.bound
    .filter(b => !placeholders.has(b.seat))
    .map(b => [b.leg, b.seat]));
  return { seatOf, bindRes, placeholders };
}

module.exports = { bindStage1Waves, orphanLegNote, missingSeatDeadWave, bindPaddedWave };
