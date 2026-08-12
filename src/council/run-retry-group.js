// src/council/run-retry-group.js
'use strict';
// Stage-1 loss grouping: lensIndexOf + recordFailure + groupStage1Losses.
// Moved verbatim from run-retry.js:24-126 (v4.8 PR0 size-gate split, zero
// behavior). Pure — parameters and builtins only, no requires.
// run-retry.js re-exports groupStage1Losses so existing import paths
// (tests/council/run-retry.test.js) stay stable.

/** 1-based lens index for a loss, from the waveId convention or the model. */
function lensIndexOf(o, waveId, model) {
  const m = /-l(\d+)$/.exec(waveId || '');
  if (m) { return Number(m[1]); }
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
 */
function recordFailure(unit, seat, ff, trackModel = true) {
  if (unit.firstFailures.some(f => f.seat === seat)) { return; }
  unit.firstFailures.push(ff);
  if (trackModel) { unit.models.push(seat); }
}

/**
 * Group Stage-1 losses into retry units. Pure — no I/O.
 * Bench losses (a dead bench wave's models + dead bench legs) collapse into
 * ONE retry wave; the critic and each lens retry as solos (their briefings
 * differ). Stable order: bench, critic, lenses ascending. The critic matches
 * on EITHER carrier — waveId convention or model — mirroring
 * verdict.js summarizeSeatLoss.
 */
function groupStage1Losses(o, deadWaves = [], deadLegs = []) {
  const isCriticWave = (w) =>
    w.waveId === `${o.runId}-c1` || (!!o.critic && (w.models || []).includes(o.critic));
  const bench = { unit: 'bench', waveId: `${o.runId}-s1r1`, retryOfWaveId: `${o.runId}-s1`,
    models: [], firstFailures: [], srcWaves: [], srcLegs: [] };
  const lensUnits = new Map(); // lensIndex (number, or null for unmappable) -> unit
  const criticUnit = { unit: 'critic', waveId: `${o.runId}-c1r1`, retryOfWaveId: `${o.runId}-c1`,
    models: o.critic ? [o.critic] : [], firstFailures: [], srcWaves: [], srcLegs: [] };

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
          models: [], firstFailures: [], srcWaves: [], srcLegs: [] }
        : { unit: 'lens', lensIndex: i, waveId: `${o.runId}-l${i}r1`,
          retryOfWaveId: `${o.runId}-l${i}`, models: [], firstFailures: [], srcWaves: [], srcLegs: [] });
    }
    return lensUnits.get(i);
  };

  for (const w of deadWaves) {
    const models = w.models || [];
    if (o.lenses) {
      const u = lensUnitFor(lensIndexOf(o, w.waveId, models[0]));
      u.srcWaves.push(w);
      models.forEach(seat => recordFailure(u, seat, { seat, class: 'wave', waveId: w.waveId, reason: w.reason }));
    } else if (isCriticWave(w)) {
      criticUnit.srcWaves.push(w);
      recordFailure(criticUnit, o.critic,
        { seat: o.critic, class: 'wave', waveId: w.waveId, reason: w.reason }, false);
    } else {
      bench.srcWaves.push(w);
      models.forEach(seat => recordFailure(bench, seat, { seat, class: 'wave', waveId: w.waveId, reason: w.reason }));
    }
  }
  for (const leg of deadLegs) {
    const seat = leg.modelInput || leg.model;
    const ff = { seat, class: 'leg', status: leg.status, reason: leg.error || null };
    if (o.lenses) {
      const u = lensUnitFor(lensIndexOf(o, null, seat));
      u.srcLegs.push(leg);
      recordFailure(u, seat, ff);
    } else if (o.critic && seat === o.critic) {
      criticUnit.srcLegs.push(leg);
      recordFailure(criticUnit, seat, ff, false);
    } else {
      bench.srcLegs.push(leg);
      recordFailure(bench, seat, ff);
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

module.exports = { lensIndexOf, recordFailure, groupStage1Losses };
