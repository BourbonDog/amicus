// src/council/run-retry-group.js
'use strict';
// Stage-1 loss grouping: lensIndexOf + recordFailure + groupStage1Losses.
// Moved verbatim from run-retry.js:24-126 (v4.8 PR0 size-gate split, zero
// behavior). Pure — parameters and builtins only, no requires.
// run-retry.js re-exports groupStage1Losses so existing import paths
// (tests/council/run-retry.test.js) stay stable.

/** 1-based lens index for a loss: the waveId convention, else the seat's own
 *  bench position, else the alias's first bench index. v4.8 PR2b H4: the old
 *  `o.models.indexOf(model)` was first-match, so twin aliases both resolved to
 *  the FIRST twin's lens and shared one retry unit — and the deadLegs loop
 *  passes waveId=null, so that branch was the only one those losses could
 *  take. The alias fallback survives for a loss with no identified seat. */
function lensIndexOf(o, waveId, model, seatObj = null) {
  const m = /-l(\d+)$/.exec(waveId || '');
  if (m) { return Number(m[1]); }
  if (seatObj && Number.isInteger(seatObj.position)) { return seatObj.position; }
  const i = (o.models || []).indexOf(model);
  return i === -1 ? null : i + 1;
}

/**
 * Dedup helper (Task-4 review hardening): the same seat can arrive twice in
 * one grouping pass — two dead legs naming it, or a dead wave and a dead leg
 * both naming it. One seat must still mean ONE `firstFailures` entry — first
 * occurrence wins — while every SOURCE record is kept regardless (srcWaves/
 * srcLegs are the audit trail and are never deduped). The critic unit's
 * `.models` is fixed at creation (there is only ever one critic seat), so
 * only bench/lens units grow `.models` here — the critic call sites pass
 * `trackModel: false`.
 *
 * v4.8 PR2b: `seatObj` rides in lockstep, so `unit.seats` stays INDEX-PARALLEL
 * to `unit.models` — same order, same length. `null` means "we could not
 * identify this seat"; it is never back-filled from an alias lookup, which is
 * exactly the guess seat identity exists to forbid.
 *
 * v4.8 PR2b H4: the dedup key is the SEAT id, falling back to the alias when no
 * seat was identified. Twin aliases are TWO seats and must retry as two; two
 * UNidentifiable losses on one alias must still collapse, because nothing
 * distinguishes them. ⚠️ The key is ADDED as `seatId`; `ff.seat` stays
 * ALIAS-valued — it becomes `data.seat` on every emitted note, which verdict.js
 * compares against `o.critic` (an alias) and the Workspace seat views render.
 * Seat-keying `ff.seat` silently breaks critic-loss detection.
 */
/**
 * The one seat-key rule: a seat's id when it was identified, its alias otherwise.
 * Exported so run-retry.js consumes it rather than re-spelling it — two readers of one
 * rule that drift apart is how the alias/seat-id keyspace splits in the first place.
 */
const seatKey = (s, alias) => (s ? s.id : alias);

/**
 * Which of a unit's srcLegs still need their own still-dead note once its srcWaves have
 * emitted theirs, plus every seat key those announcements cover.
 *
 * v4.8 PR5c: an UNIDENTIFIED wave slot keys by ALIAS (seatKey's fallback) while a leg that
 * WAS bound keys by its seat id, so a plain `noted.has(key)` test misses and the same seat
 * is announced TWICE, once per keyspace. HEAD hides this downstream because the Workspace's
 * dead-row dedup is alias-keyed too and both collapse into one row; seat-keying that
 * consumer (PR5c Task 2) turns it into a visible duplicate row.
 *
 * A per-alias BUDGET of unnamed slots, not a second alias Set: the wave announced N seats of
 * this alias without naming them, so at most N later legs on that alias are re-announcements
 * of seats already covered. Blanket alias suppression would silently drop a genuinely
 * distinct twin — a miss, which is the worse failure direction.
 *
 * @returns {{attempted: Set<string>, legs: Array<{leg: object, seatId: ?string}>}}
 */
function planStillDeadSources(unit, seatOf) {
  const noted = new Set();
  const attempted = new Set();
  const unnamedByAlias = new Map();
  for (const w of unit.srcWaves) {
    (w.models || []).forEach((m, i) => {
      const seatObj = (w.seats || [])[i] || null;
      const k = seatKey(seatObj, m);
      noted.add(k); attempted.add(k);
      if (!seatObj) { unnamedByAlias.set(m, (unnamedByAlias.get(m) || 0) + 1); }
    });
  }
  const legs = [];
  for (const l of unit.srcLegs) {
    const bound = seatOf.get(l) || null;
    const alias = l.modelInput || l.model;
    const key = seatKey(bound, alias);
    attempted.add(key);
    if (noted.has(key)) { continue; }
    const unnamed = unnamedByAlias.get(alias) || 0;
    // This leg IS one of the seats the wave already announced unnamed. Claim that slot
    // and stay silent — the wave's note covers it. Still an ATTEMPTED seat.
    if (unnamed > 0) { unnamedByAlias.set(alias, unnamed - 1); continue; }
    noted.add(key);
    legs.push({ leg: l, seatId: bound ? bound.id : null });
  }
  return { attempted, legs };
}

function recordFailure(unit, seat, ff, trackModel = true, seatObj = null) {
  const key = seatObj ? seatObj.id : seat;
  if (unit.firstFailures.some(f => f.seatId === key)) { return; }
  unit.firstFailures.push({ ...ff, seatId: key });
  if (trackModel) { unit.models.push(seat); unit.seats.push(seatObj); }
}

/**
 * Group Stage-1 losses into retry units. Pure — no I/O.
 * Bench losses (a dead bench wave's models + dead bench legs) collapse into
 * ONE retry wave; the critic and each lens retry as solos (their briefings
 * differ). Stable order: bench, critic, lenses ascending. The critic matches
 * on EITHER carrier — waveId convention or model — mirroring
 * verdict.js summarizeSeatLoss.
 *
 * `seatOf` (v4.8 PR2b) is Stage-1's leg->seat binding, keyed by leg OBJECT
 * identity: it is how a dead LEG contributes the seat it was actually bound to
 * rather than one guessed from its alias. A wave-origin loss carries its own
 * roster on `w.seats`, positionally parallel to `w.models`.
 */
function groupStage1Losses(o, deadWaves = [], deadLegs = [], seatOf = new Map()) {
  const isCriticWave = (w) =>
    w.waveId === `${o.runId}-c1` || (!!o.critic && (w.models || []).includes(o.critic));
  const bench = { unit: 'bench', waveId: `${o.runId}-s1r1`, retryOfWaveId: `${o.runId}-s1`,
    models: [], seats: [], firstFailures: [], srcWaves: [], srcLegs: [] };
  const lensUnits = new Map(); // lensIndex (number, or null for unmappable) -> unit
  // Seeded exactly like `models`, and gated on the same `o.critic` so the two
  // arrays cannot diverge in LENGTH when the critic's seat cannot be resolved
  // (a caller with no o.seats): `[null]` says "unidentified", `[]` would say
  // "no slot at all" and shift the retry roster.
  const criticSeatObj = (o.seats || []).find(s => s.alias === o.critic) || null;
  const criticUnit = { unit: 'critic', waveId: `${o.runId}-c1r1`, retryOfWaveId: `${o.runId}-c1`,
    models: o.critic ? [o.critic] : [], seats: o.critic ? [criticSeatObj] : [],
    firstFailures: [], srcWaves: [], srcLegs: [] };

  const lensUnitFor = (i) => {
    if (!lensUnits.has(i)) {
      // Task-4 review hardening: an unmappable loss (lensIndexOf resolved
      // neither the waveId convention nor a model-roster membership) must
      // still be GROUPABLE — dropping it here would let it vanish before the
      // orchestrator ever sees it — but must not manufacture a fake
      // `-lnullr1` waveId. The orchestrator refuses to launch any unit with
      // `lensIndex === null` and routes its sources to skipped instead.
      lensUnits.set(i, i === null
        ? { unit: 'lens', lensIndex: null, waveId: null, retryOfWaveId: null,
          models: [], seats: [], firstFailures: [], srcWaves: [], srcLegs: [] }
        : { unit: 'lens', lensIndex: i, waveId: `${o.runId}-l${i}r1`,
          retryOfWaveId: `${o.runId}-l${i}`, models: [], seats: [],
          firstFailures: [], srcWaves: [], srcLegs: [] });
    }
    return lensUnits.get(i);
  };

  // v4.8 PR2b Task 7 (R-B): a `partial` record is stage1-bind.js's
  // missingSeatDeadWave — ONE seat of a wave that DID return legs, just not
  // this seat's. It retries exactly like a dead wave, but its loss CLASS is
  // 'missing': every still-dead/heal builder reads ff.class, and a 'wave'
  // record makes them claim the wave "produced no legs", which is false.
  // A partial critic record is stamped `-c1`, so it matches isCriticWave and
  // would otherwise be recorded 'wave' on that branch alone.
  const lossClass = w => (w.partial ? 'missing' : 'wave');
  for (const w of deadWaves) {
    const models = w.models || [];
    if (o.lenses) {
      const u = lensUnitFor(lensIndexOf(o, w.waveId, models[0], (w.seats || [])[0] || null));
      u.srcWaves.push(w);
      models.forEach((seat, idx) => recordFailure(u, seat,
        { seat, class: lossClass(w), waveId: w.waveId, reason: w.reason }, true, (w.seats || [])[idx] || null));
    } else if (isCriticWave(w)) {
      criticUnit.srcWaves.push(w);
      // criticSeatObj rides even though trackModel is false: it is already
      // criticUnit.seats[0], so keying the firstFailure off it is what keeps
      // the dedup key and the roster slot's key the SAME string.
      recordFailure(criticUnit, o.critic,
        { seat: o.critic, class: lossClass(w), waveId: w.waveId, reason: w.reason }, false, criticSeatObj);
    } else {
      bench.srcWaves.push(w);
      models.forEach((seat, idx) => recordFailure(bench, seat,
        { seat, class: lossClass(w), waveId: w.waveId, reason: w.reason }, true, (w.seats || [])[idx] || null));
    }
  }
  for (const leg of deadLegs) {
    const seat = leg.modelInput || leg.model;
    const ff = { seat, class: 'leg', status: leg.status, reason: leg.error || null };
    if (o.lenses) {
      const u = lensUnitFor(lensIndexOf(o, null, seat, seatOf.get(leg) || null));
      u.srcLegs.push(leg);
      recordFailure(u, seat, ff, true, seatOf.get(leg) || null);
    } else if (o.critic && seat === o.critic) {
      criticUnit.srcLegs.push(leg);
      recordFailure(criticUnit, seat, ff, false, criticSeatObj);
    } else {
      bench.srcLegs.push(leg);
      recordFailure(bench, seat, ff, true, seatOf.get(leg) || null);
    }
  }

  const out = [];
  // Task-4 review hardening: gate on whether the unit received any SOURCE
  // record, not on firstFailures.length — a zero-model dead wave contributes
  // a srcWaves entry but nothing to firstFailures/models (nothing for the
  // `.forEach` above to iterate), and must still surface here so the
  // orchestrator can route it to skipped instead of it vanishing silently.
  if (bench.srcWaves.length > 0 || bench.srcLegs.length > 0) { out.push(bench); }
  if (criticUnit.srcWaves.length > 0 || criticUnit.srcLegs.length > 0) { out.push(criticUnit); }
  // Coordinator-review MINOR-7a: null sorts LAST (Infinity), not first (0) —
  // an unmappable loss is not "lens index 0"; it should not perturb the
  // ascending order of the real, well-indexed lens retries.
  out.push(...[...lensUnits.values()].sort((a, b) => (a.lensIndex ?? Infinity) - (b.lensIndex ?? Infinity)));
  return out;
}

module.exports = { lensIndexOf, recordFailure, groupStage1Losses, planStillDeadSources, seatKey };
